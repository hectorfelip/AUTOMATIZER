#!/usr/bin/env python3
"""SPIKE (Fase 7, ADR 0016): a captura global de mouse e teclado funciona no seu Windows?

ESBOÇO NÃO EXECUTADO: escrito sem acesso a um Windows.

Uso (Windows, PowerShell):
    python -m pip install pynput
    python scripts\\spike-recorder.py            # captura por 10 s e imprime os eventos
    python scripts\\spike-recorder.py 20         # captura por 20 s

PRIVACIDADE: este spike NÃO mostra as teclas digitadas (só o TIPO do evento e se é tecla comum ou especial);
nada é gravado em arquivo. Mesmo assim, não digite senhas enquanto ele roda.
"""

import sys
import time


def main() -> int:
    if sys.platform != "win32":
        print("[rec] este spike só roda no Windows.")
        return 2
    try:
        from pynput import keyboard, mouse
    except ImportError as e:
        print(f"[rec] FALHA de import: {e}. Rode: python -m pip install pynput")
        return 1
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0
    events: list[tuple[float, str]] = []
    t0 = time.monotonic()

    def log(kind: str) -> None:
        events.append((time.monotonic() - t0, kind))

    m = mouse.Listener(
        on_click=lambda x, y, b, pressed: log(f"mouse {'down' if pressed else 'up'} {b.name} @({x},{y})"),
        on_scroll=lambda x, y, dx, dy: log(f"scroll @({x},{y}) d=({dx},{dy})"),
    )
    k = keyboard.Listener(
        on_press=lambda key: log("tecla " + ("especial" if hasattr(key, "name") else "comum") + " (pressionada)"),
        on_release=lambda key: log("tecla solta"),
    )
    print(f"[rec] capturando por {seconds:g} s — clique, role e digite algo (sem senhas)...")
    m.start()
    k.start()
    time.sleep(seconds)
    m.stop()
    k.stop()
    print(f"[rec] OK: {len(events)} evento(s)")
    for t, kind in events[:40]:
        print(f"[rec]   {t:6.2f}s  {kind}")
    if not events:
        print("[rec] ATENÇÃO: nenhum evento. Antivírus ou aplicativo elevado em foco pode bloquear a captura.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
