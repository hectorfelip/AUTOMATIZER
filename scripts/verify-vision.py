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


def diagnose_image(path: str, cfg: dict) -> None:
    """Por que não achou? Mostra o tamanho do recorte × tela e o melhor ponto, e salva o que o motor VIU (para comparar a olho)."""
    from automation_engine.actions import vision_image as vi

    tpl = vi.load_template(path)
    region = (cfg["regionX"], cfg["regionY"], cfg["regionWidth"], cfg["regionHeight"]) if "regionX" in cfg else None
    shot = vi.WindowsScreen().capture(region)
    found, seen = vi.find_image(shot, tpl, 0.0)
    out = Path(path).with_name("verify-vision-tela.png")
    shot.save(out)
    print(f"[vision] diagnóstico: recorte {tpl.width}x{tpl.height} (contraste {tpl.baseline:.1f}); tela vista {shot.size[0]}x{shot.size[1]}")
    if found:
        print(f"[vision] melhor ponto: ({found.x},{found.y}) similaridade {found.similarity}. Se esse ponto não é o ícone, o recorte difere da tela (escala/DPI, tema, cursor, transparência).")
    else:
        print("[vision] o recorte é maior que a tela vista (confira região/escala).")
    try:  # escala REAL do Windows (porcentagem) e resolução física, para comparar com a "tela vista" acima
        import ctypes
        import subprocess

        pct = ctypes.windll.shcore.GetScaleFactorForDevice(0)  # type: ignore[attr-defined]
        phys = subprocess.run([sys.executable, "-c", "import ctypes;u=ctypes.windll.user32;u.SetProcessDPIAware();print(u.GetSystemMetrics(0),u.GetSystemMetrics(1))"], capture_output=True, text=True, timeout=10).stdout.strip()
        print(f"[vision] Windows: escala {pct}%, resolução física {phys} (a tela vista acima é o que o motor enxerga)")
    except Exception as e:  # noqa: BLE001
        print(f"[vision] não consegui ler a escala do Windows ({type(e).__name__})")
    print("[vision] sonda de escala (fator aplicado ao recorte → melhor similaridade; 1.0 = recorte original):")
    for f, sim in vi.scale_probe(shot, tpl):
        print(f"[vision]   {f:5.3f} → {sim:.3f}")
    print("[vision] Se algum fator ≠ 1.0 passar de ~0.8, o recorte foi feito em outra escala que a captura (DPI).")
    print(f"[vision] captura salva em {out} — abra e compare com o recorte (se estiver preta/vazia, o problema é a captura).")


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
        if e.code == "IMAGE_NOT_FOUND_ON_SCREEN":
            diagnose_image(path, cfg)
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
