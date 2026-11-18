"""Ponto de entrada do executável do motor (PyInstaller não usa `python -m`)."""

import sys

from automation_engine.runtime.main import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
