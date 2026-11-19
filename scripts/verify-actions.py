#!/usr/bin/env python3
"""Verifica as ações do motor DE VERDADE (sem o app): arquivos (automático) e, no Windows, Bloco de Notas
(abrir, ativar janela, clicar, digitar, atalho) com confirmação visual.

Uso (no venv do motor, com requirements-windows.txt instalado):
    python scripts/verify-actions.py [--title "Bloco de Notas"] [--no-visual]

--title    parte do título da janela do Bloco de Notas no seu idioma (padrão: "Bloco de Notas"; em inglês: "Notepad")
--no-visual  não pede confirmação visual (só verifica o que dá para checar por código)
"""

import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "engine" / "python"))

from automation_engine import actions  # noqa: E402,F401
from automation_engine.runtime import registry  # noqa: E402
from automation_engine.runtime.context import ActionContext, ActionError  # noqa: E402

results: list[tuple[str, bool, str]] = []


def run(action: str, config: dict) -> dict:
    ctx = ActionContext("verify", "n", config, threading.Event(), lambda p, m: None)
    return registry.get_action(action)(ctx) or {}  # type: ignore[misc]


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"[actions] {'OK   ' if ok else 'FALHA'} {name}{(' — ' + detail) if detail else ''}")
    return ok


def expect_error(name: str, action: str, config: dict, code: str) -> None:
    try:
        run(action, config)
        check(name, False, f"deveria falhar com {code}")
    except ActionError as e:
        check(name, e.code == code, f"{e.code}: {e.message}")


def files_section() -> None:
    print("\n--- Arquivos (automático) ---")
    base = Path(tempfile.mkdtemp(prefix="as-verify-"))
    src, dst = base / "in", base / "out"
    src.mkdir()
    for n in ("a.pdf", "b.pdf", "nota.txt"):
        (src / n).write_text(n, encoding="utf-8")
    sep = os.sep

    check("listar com filtro", run("files.list", {"path": str(src), "pattern": "*.pdf"})["outputs"]["count"] == 2)
    check("verificar existência (existe)", run("files.exists", {"path": str(src)})["next"] == "true")
    check("verificar existência (não existe)", run("files.exists", {"path": str(base / "x")})["next"] == "false")
    check("criar pasta", run("files.create_folder", {"path": str(dst / "sub")})["outputs"]["created"] is True)
    out = run("files.copy", {"source": f"{src}{sep}*.pdf", "destination": str(dst)})["outputs"]
    check("copiar com curinga", out["count"] == 2 and (src / "a.pdf").exists() and (dst / "a.pdf").exists())
    expect_error("copiar não sobrescreve sem permissão", "files.copy", {"source": f"{src}{sep}*.pdf", "destination": str(dst)}, "DESTINATION_EXISTS")
    out = run("files.move", {"source": f"{src}{sep}*.pdf", "destination": str(dst), "overwrite": True})["outputs"]
    check("mover sobrescrevendo", out["count"] == 2 and out["overwritten"] == 2 and not (src / "a.pdf").exists())
    run("files.rename", {"path": str(dst / "a.pdf"), "newName": "renomeado.pdf"})
    check("renomear", (dst / "renomeado.pdf").exists())
    if os.name == "nt":  # no Windows ":" é inválido em nomes de arquivo
        expect_error("renomear recusa nome inválido", "files.rename", {"path": str(dst / "b.pdf"), "newName": "a:b"}, "INVALID_CONFIG")
    expect_error("caminho relativo é recusado", "files.list", {"path": "relativo"}, "INVALID_CONFIG")
    # acentos e espaços no caminho (Fase 9 vai ampliar isto)
    acc = base / "Pasta com acento e espaço ção"
    run("files.create_folder", {"path": str(acc)})
    (src / "relatório final.pdf").write_text("x", encoding="utf-8")
    run("files.move", {"source": str(src / "relatório final.pdf"), "destination": str(acc)})
    check("caminho com acentos e espaços", (acc / "relatório final.pdf").exists())


def windows_section(title: str, visual: bool) -> None:
    print("\n--- Janelas, teclado e mouse (Windows) ---")
    if sys.platform == "win32":
        # antes de tudo: o Python que está rodando ESTE script tem as bibliotecas? (o erro mais comum é usar o Python do sistema)
        missing = []
        for lib in ("pywinauto", "pyautogui"):
            try:
                __import__(lib)
            except Exception as e:  # noqa: BLE001
                missing.append(f"{lib} ({type(e).__name__}: {str(e)[:120]})")
        if missing:
            print(f"[actions] ATENÇÃO Python em uso: {sys.executable}")
            print(f"[actions] ATENÇÃO não importa: {', '.join(missing)}")
            print("[actions] Instale e rode de novo:  python -m pip install -r engine\\python\\requirements-windows.txt")
    if sys.platform != "win32":
        print("[actions] --    não se aplica fora do Windows")
        return
    pid = None
    try:
        r = run("windows.open_app", {"application": "notepad.exe"})
        check("abrir aplicativo (notepad.exe)", r["outputs"]["pid"] > 0, f"PID {r['outputs']['pid']}")
        w = run("windows.activate_window", {"title": title, "timeoutSeconds": 15})
        pid = w["outputs"]["pid"]
        check("localizar e ativar a janela", True, f"“{w['outputs']['title']}”")

        from pywinauto import Desktop  # type: ignore[import-not-found]

        rect = next(x for x in Desktop(backend="uia").windows() if title.lower() in x.window_text().lower()).rectangle()
        cx, cy = (rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2
        run("input.click", {"x": cx, "y": cy, "button": "left"})
        check("clicar no centro da janela", True, f"({cx}, {cy})")

        text = "Olá! Ação, ç, ñ + 1 = 2 (teste) {chaves} 100% ~til ^circ"
        run("input.type_text", {"text": text})
        check("digitar texto com acentos e caracteres especiais", True, text)
        run("input.hotkey", {"keys": "ctrl+a"})
        check("atalho ctrl+a", True)

        expect_error("janela inexistente dá erro claro", "windows.activate_window", {"title": "JanelaQueNaoExiste-xyz", "timeoutSeconds": 1}, "WINDOW_NOT_FOUND")
        expect_error("clique fora da tela é recusado", "input.click", {"x": 99999, "y": 99999}, "COORDINATES_OUT_OF_SCREEN")

        if visual:
            print("\n>>> Olhe o Bloco de Notas: o texto digitado deve estar ali, TODO SELECIONADO (por causa do ctrl+a):")
            print(f">>>   {text}")
            ans = input(">>> O texto está exatamente assim, com acentos e símbolos corretos? (s/n) ").strip().lower()
            check("texto digitado confere (confirmação visual)", ans.startswith("s"), "" if ans.startswith("s") else "resposta: " + ans)
    except ActionError as e:
        check("ações de janela/teclado/mouse", False, f"{e.code}: {e.message}")
    finally:
        if pid:  # fecha o Bloco de Notas sem perguntar se quer salvar
            subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
            time.sleep(0.5)


def main(argv: list[str]) -> int:
    title = argv[argv.index("--title") + 1] if "--title" in argv else "Bloco de Notas"
    files_section()
    windows_section(title, visual="--no-visual" not in argv)
    failed = [r for r in results if not r[1]]
    print("\n[actions] " + ("PASSOU em todas as verificações." if not failed else f"FALHOU: {len(failed)} de {len(results)} verificações."))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
