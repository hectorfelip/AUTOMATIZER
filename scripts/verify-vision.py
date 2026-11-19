#!/usr/bin/env python3
"""Valida `vision.find_text` DE VERDADE no Windows (ação do motor, sem o app).

Uso (no Python do motor, com engine\\python\\requirements-vision.txt instalado):
    python scripts\\verify-vision.py "Lixeira"            # procura o texto na tela inteira
    python scripts\\verify-vision.py "Arquivo" --region 0,0,800,60 --similarity 0.7
    python scripts\\verify-vision.py --image C:\\caminho\\recorte.png    # localiza uma IMAGEM (recorte feito nesta mesma escala/DPI)

Deixe o texto procurado VISÍVEL na tela. Imprime onde achou (centro em pixels), a similaridade e o tempo.
"""

import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "engine" / "python"))

from automation_engine import actions  # noqa: E402,F401
from automation_engine.runtime import registry  # noqa: E402
from automation_engine.runtime.context import ActionContext, ActionError  # noqa: E402


def main_image(argv: list[str]) -> int:
    path = argv[argv.index("--image") + 1] if len(argv) > argv.index("--image") + 1 else ""
    cfg: dict = {"imagePath": path, "timeoutSeconds": 8}
    if "--similarity" in argv:
        cfg["similarity"] = float(argv[argv.index("--similarity") + 1])
    if "--region" in argv:
        x, y, w, h = (int(v) for v in argv[argv.index("--region") + 1].split(","))
        cfg.update(regionX=x, regionY=y, regionWidth=w, regionHeight=h)
    print(f"[vision] Python {sys.version.split()[0]} em {sys.platform}; procurando a imagem {path} (até 8 s)…")
    ctx = ActionContext("verify", "n", cfg, threading.Event(), lambda p, m: None)
    t0 = time.monotonic()
    try:
        out = registry.get_action("vision.find_image")(ctx) or {}  # type: ignore[misc]
    except ActionError as e:
        print(f"[vision] FALHA {e.code}: {e.message}")
        return 1
    o = out["outputs"]
    print(f"[vision] OK em {time.monotonic() - t0:.2f} s: centro=({o['centerX']},{o['centerY']}) caixa=({o['x']},{o['y']},{o['width']}x{o['height']}) similaridade={o['similarity']} tentativas={o['attempts']}")
    return 0


def main(argv: list[str]) -> int:
    if "--image" in argv:
        return main_image(argv)
    if len(argv) < 2 or argv[1].startswith("--"):
        print(__doc__)
        return 2
    cfg: dict = {"text": argv[1], "timeoutSeconds": 8}
    if "--similarity" in argv:
        cfg["similarity"] = float(argv[argv.index("--similarity") + 1])
    if "--region" in argv:
        x, y, w, h = (int(v) for v in argv[argv.index("--region") + 1].split(","))
        cfg.update(regionX=x, regionY=y, regionWidth=w, regionHeight=h)
    print(f"[vision] Python {sys.version.split()[0]} em {sys.platform}; procurando “{argv[1]}” (até 8 s)…")
    ctx = ActionContext("verify", "n", cfg, threading.Event(), lambda p, m: None)
    t0 = time.monotonic()
    try:
        out = registry.get_action("vision.find_text")(ctx) or {}  # type: ignore[misc]
    except ActionError as e:
        print(f"[vision] FALHA {e.code}: {e.message}")
        return 1
    o = out["outputs"]
    print(f"[vision] OK em {time.monotonic() - t0:.2f} s: “{o['matchedText']}” centro=({o['centerX']},{o['centerY']}) caixa=({o['x']},{o['y']},{o['width']}x{o['height']}) similaridade={o['similarity']} tentativas={o['attempts']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
