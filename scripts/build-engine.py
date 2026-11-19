#!/usr/bin/env python3
"""Gera o executável do motor com PyInstaller (modo onedir) em engine/python/dist/automation-engine/.

Uso (dentro de um venv com requirements-build.txt, e requirements-windows.txt no Windows):
    python scripts/build-engine.py
"""

import importlib.util
import subprocess
import sys
from pathlib import Path

ENGINE = Path(__file__).resolve().parent.parent / "engine" / "python"
# Incluídas só se estiverem instaladas neste ambiente. `collect-all` traz código, dados e binários (driver Node do playwright,
# backends do pynput carregados dinamicamente, extensões .pyd do winrt). O build NÃO prova que importam: rode verify-engine.py.
OPTIONAL = [
    "pywinauto", "pyautogui", "PIL", "playwright", "pynput",
    "winrt.runtime", "winrt.windows.globalization", "winrt.windows.graphics.imaging", "winrt.windows.media.ocr",
    "winrt.windows.storage", "winrt.windows.storage.streams", "winrt.windows.foundation", "winrt.windows.foundation.collections",
]
# Distribuições cujo nome no pip difere do módulo (para `--copy-metadata`).
METADATA = {"PIL": "pillow"}


def main() -> int:
    if importlib.util.find_spec("PyInstaller") is None:
        print("PyInstaller não instalado. Rode: pip install -r engine/python/requirements-build.txt", file=sys.stderr)
        return 2
    cmd = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--console",
        "--name", "automation-engine",
        "--distpath", str(ENGINE / "dist"), "--workpath", str(ENGINE / "build"), "--specpath", str(ENGINE / "build"),
        "--paths", str(ENGINE),
    ]
    included = []
    for module in OPTIONAL:
        try:
            found = importlib.util.find_spec(module) is not None
        except (ImportError, ValueError):  # pacote-pai ausente (ex.: winrt fora do Windows)
            found = False
        if found:
            # collect-all: código, dados e binários do pacote; copy-metadata: para importlib.metadata.version() funcionar congelado
            cmd += ["--collect-all", module]
            if "." not in module:
                cmd += ["--copy-metadata", METADATA.get(module, module)]
            included.append(module)
    cmd.append(str(ENGINE / "entry.py"))

    print(f"[build] Python {sys.version.split()[0]} em {sys.platform}; módulos opcionais incluídos: {included or 'nenhum'}")
    subprocess.check_call(cmd)

    out = ENGINE / "dist" / "automation-engine"
    exe = out / ("automation-engine.exe" if sys.platform == "win32" else "automation-engine")
    if not exe.exists():
        print(f"[build] FALHOU: {exe} não foi gerado", file=sys.stderr)
        return 1
    size_mb = sum(f.stat().st_size for f in out.rglob("*") if f.is_file()) / 1e6
    print(f"[build] OK: {exe}  ({size_mb:.1f} MB na pasta)")
    print(f"[build] Próximo passo: python scripts/verify-engine.py \"{exe}\"")
    return 0


if __name__ == "__main__":
    sys.exit(main())
