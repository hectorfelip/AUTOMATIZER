#!/usr/bin/env python3
"""Valida `windows.click_element` DE VERDADE no Windows (ação do motor, sem o app). Usa o Bloco de Notas.

Uso (no Python do motor, com requirements-windows.txt instalado):
    python scripts\\verify-uia.py                    # abre o Bloco de Notas e clica no menu "Arquivo" (ou "File")
    python scripts\\verify-uia.py "Calculadora" "Um" # janela e elemento à sua escolha (a janela já deve estar aberta)

O mouse VAI se mover e clicar. Jogue o mouse no canto superior esquerdo da tela para abortar (parada de emergência).
Imprime o que achou (nome, tipo, posição) ou o erro completo.
"""

import subprocess
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "engine" / "python"))

from automation_engine import actions  # noqa: E402,F401
from automation_engine.runtime import registry  # noqa: E402
from automation_engine.runtime.context import ActionContext, ActionError  # noqa: E402


def main(argv: list[str]) -> int:
    if sys.platform != "win32":
        print("[uia] este script só roda no Windows.")
        return 2
    print(f"[diag] Python {sys.version.split()[0]} em {sys.platform}")
    proc = None
    if len(argv) >= 3:
        window, element = argv[1], argv[2]
    else:
        proc = subprocess.Popen(["notepad.exe"])
        time.sleep(2.0)
        window, element = "Bloco de Notas", "Arquivo"
        print("[uia] Bloco de Notas aberto; procurando o menu 'Arquivo' (se o Windows estiver em inglês, rode: python scripts\\verify-uia.py Notepad File)")
    cfg = {"windowTitle": window, "elementName": element, "timeoutSeconds": 8}
    ctx = ActionContext("verify", "n", cfg, threading.Event(), lambda p, m: None)
    t0 = time.monotonic()
    try:
        out = registry.get_action("windows.click_element")(ctx) or {}  # type: ignore[misc]
    except ActionError as e:
        print(f"[uia] FALHA {e.code}: {e.message}")
        return 1
    except Exception as e:  # noqa: BLE001
        import traceback

        traceback.print_exc()
        print(f"[uia] FALHA inesperada: {type(e).__name__}: {e}")
        return 1
    o = out["outputs"]
    print(f"[uia] OK em {time.monotonic() - t0:.2f} s: “{o['name']}” ({o['controlType']}) clicado em ({o['x']},{o['y']})")
    if proc:
        print("[uia] Confira se o menu abriu e feche o Bloco de Notas.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
