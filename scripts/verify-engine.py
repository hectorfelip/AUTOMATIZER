#!/usr/bin/env python3
"""Verifica um executável do motor: handshake, ping, uma ação, cancelamento e encerramento.

Uso:
    python scripts/verify-engine.py <caminho-do-executável> [--clean-path]

--clean-path remove do PATH qualquer pasta com Python, simulando uma máquina sem Python instalado
(é o que o usuário final tem).
"""

import json
import os
import queue
import subprocess
import sys
import threading
import time

TIMEOUT = 20.0


def main(argv: list[str]) -> int:
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    exe = argv[0]
    env = dict(os.environ)
    if "--clean-path" in argv:
        sep = os.pathsep
        keep = [p for p in env.get("PATH", "").split(sep) if p and "python" not in p.lower()]
        env["PATH"] = sep.join(keep)
        env.pop("PYTHONPATH", None)
        env.pop("PYTHONHOME", None)
        print(f"[verify] PATH sem Python ({len(keep)} pastas mantidas)")

    results: list[tuple[str, bool, str]] = []
    windows = sys.platform == "win32"

    def check(name: str, ok: bool, detail: str = "", windows_only: bool = False) -> bool:
        if windows_only and not windows:  # pywinauto/pyautogui só existem no Windows: aqui não se aplica
            print(f"[verify] --    {name} — não se aplica fora do Windows")
            return True
        results.append((name, ok, detail))
        print(f"[verify] {'OK   ' if ok else 'FALHA'} {name}{(' — ' + detail) if detail else ''}")
        return ok

    # --- 1. selftest: dependências importam dentro do executável congelado? ---
    try:
        st = subprocess.run([exe, "--selftest"], capture_output=True, timeout=TIMEOUT, env=env)
        data = json.loads(st.stdout.decode().strip().splitlines()[-1])
        check("executável roda (--selftest)", st.returncode == 0, f"frozen={data['frozen']} python={data['python']} {data['platform']}")
        for mod, res in data["imports"].items():
            check(f"importa {mod}", res == "ok", res, windows_only=True)
    except Exception as e:  # noqa: BLE001
        check("executável roda (--selftest)", False, f"{type(e).__name__}: {e}")
        return report(results)

    # --- 2. protocolo ---
    t0 = time.monotonic()
    proc = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    inbox: "queue.Queue[dict]" = queue.Queue()
    bad: list[bytes] = []

    def pump() -> None:
        for line in proc.stdout:  # type: ignore[union-attr]
            try:
                inbox.put(json.loads(line))
            except ValueError:
                bad.append(line)

    threading.Thread(target=pump, daemon=True).start()

    def send(type_: str, rid: str, payload: dict) -> None:
        proc.stdin.write(json.dumps({"type": type_, "requestId": rid, "payload": payload}).encode() + b"\n")  # type: ignore[union-attr]
        proc.stdin.flush()  # type: ignore[union-attr]

    def recv(type_: str, timeout: float = TIMEOUT) -> dict | None:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                m = inbox.get(timeout=0.1)
            except queue.Empty:
                continue
            if m["type"] == type_:
                return m
        return None

    ready = recv("ready")
    startup = time.monotonic() - t0
    if not check("responde 'ready'", ready is not None, f"{startup:.2f}s até o handshake"):
        proc.kill()
        return report(results)
    p = ready["payload"]
    check("versão do protocolo", p["protocolVersion"] == 1, f"motor {p['engineVersion']}, python {p['python']}")
    for mod, info in p["optionalModules"].items():
        check(f"metadados de {mod} no executável", info["version"] is not None, str(info["version"]), windows_only=True)

    send("ping", "v1", {})
    check("ping/pong", recv("pong") is not None)

    send("execute_action", "v2", {"executionId": "v", "nodeId": "n", "action": "flow.wait", "config": {"seconds": 0.3}})
    done = recv("action_completed")
    check("executa uma ação (flow.wait)", done is not None and done["payload"]["status"] == "success")

    send("execute_action", "v3", {"executionId": "v", "nodeId": "n", "action": "flow.wait", "config": {"seconds": 30}})
    recv("action_started")
    t1 = time.monotonic()
    send("cancel", "v4", {"executionId": "v"})
    cancelled = recv("action_cancelled", 5)
    check("cancelamento cooperativo", cancelled is not None, f"{time.monotonic() - t1:.2f}s")

    send("shutdown", "v5", {})
    check("encerra com 'bye'", recv("bye", 5) is not None)
    try:
        code = proc.wait(5)
        check("processo sai com código 0", code == 0, f"código {code}")
    except subprocess.TimeoutExpired:
        proc.kill()
        check("processo sai com código 0", False, "não saiu em 5 s")
    check("stdout só tem protocolo", not bad, f"{len(bad)} linhas inválidas" if bad else "")
    return report(results)


def report(results: list[tuple[str, bool, str]]) -> int:
    failed = [r for r in results if not r[1]]
    print("\n[verify] " + ("PASSOU em todas as verificações." if not failed else f"FALHOU: {len(failed)} de {len(results)} verificações."))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
