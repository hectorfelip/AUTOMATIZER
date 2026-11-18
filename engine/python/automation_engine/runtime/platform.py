"""Ponto único para perguntar "estamos no Windows?" (os testes substituem isto)."""

import sys


def is_windows() -> bool:
    return sys.platform == "win32"
