import json
import sys
from typing import Optional, Sequence

from .. import actions  # noqa: F401  (registra as ações embutidas)
from .engine import OPTIONAL_MODULES, Engine


def _selftest() -> int:
    """`--selftest`: diz se o executável empacotado consegue importar as dependências (spike da Fase 3)."""
    import importlib

    result = {}
    for name in OPTIONAL_MODULES:
        try:
            importlib.import_module(name)
            result[name] = "ok"
        except Exception as e:  # noqa: BLE001
            result[name] = f"{type(e).__name__}: {e}"[:200]
    print(json.dumps({"python": sys.version.split()[0], "platform": sys.platform, "frozen": getattr(sys, "frozen", False), "imports": result}))
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    if argv and "--selftest" in argv:
        return _selftest()
    # stdout é do protocolo: guardamos o canal binário e apontamos `sys.stdout` para stderr,
    # assim qualquer print() (nosso ou de bibliotecas) vira diagnóstico, não protocolo.
    protocol_out = sys.stdout.buffer
    sys.stdout = sys.stderr
    try:
        return Engine(sys.stdin.buffer, protocol_out).run()
    except (BrokenPipeError, KeyboardInterrupt):
        return 0
