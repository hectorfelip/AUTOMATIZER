"""Visão: localizar uma IMAGEM de referência na tela, só com Pillow (sem numpy/OpenCV). ADR 0015.

Similaridade 0–1 = 1 − (diferença média absoluta ÷ diferença do modelo contra um cinza liso). Assim "nada parecido" cai perto de 0
(e não perto de 0,8, como aconteceria com 1 − diff/255 num ícone escuro sobre fundo branco). Escala/DPI e tema precisam coincidir:
a imagem de referência deve ser um recorte da tela NA ESCALA em que o fluxo vai rodar.

Busca em duas etapas: grossa (tela e modelo reduzidos) para achar candidatos; fina (resolução cheia, vizinhança dos candidatos).
# ponytail: Pillow não tem correlação cruzada; este custo é O(posições) em Python. Se ficar lento em telas 4K, reduzir a região
# de busca ou subir para numpy/OpenCV (decisão registrada no ADR 0015).
"""

from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional, Protocol

from ..runtime.context import ActionContext, ActionError
from ..runtime.registry import action
from .paths import resolve_path
from .vision import POLL_SECONDS, _num, _region
from .windows import dependency_missing, require_windows

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".bmp")
MAX_FILE_BYTES = 5 * 1024 * 1024
MIN_SIDE, MAX_SIDE = 8, 800
MIN_CONTRAST = 4.0  # modelo quase liso casaria com qualquer área lisa da tela
COARSE_BUDGET = 40_000  # posições avaliadas na etapa grossa
CANDIDATES = 6


class Screen(Protocol):
    def capture(self, region: Optional[tuple[int, int, int, int]]) -> Any:
        """Imagem PIL da tela (ou da região x,y,largura,altura)."""


_screen: Optional[Screen] = None


def set_screen(s: Optional[Screen]) -> None:
    global _screen
    _screen = s


class WindowsScreen:
    def capture(self, region: Optional[tuple[int, int, int, int]]) -> Any:
        try:
            import pyautogui  # type: ignore[import-not-found]
        except ImportError as e:
            raise dependency_missing("pyautogui", e) from None
        return pyautogui.screenshot(region=region) if region else pyautogui.screenshot()


def _pil() -> Any:
    try:
        from PIL import Image, ImageChops, ImageStat  # type: ignore[import-not-found]
    except ImportError as e:
        raise dependency_missing("pillow", e) from None
    return Image, ImageChops, ImageStat


@dataclass(frozen=True)
class Found:
    similarity: float
    x: int
    y: int


class Template:
    """Modelo pronto para casar: cinza, com o 'contraste' (diferença do cinza liso) calculado uma vez."""

    def __init__(self, img: Any):
        Image, ImageChops, ImageStat = _pil()
        self.img = img.convert("L")
        self.width, self.height = self.img.size
        self.baseline = self._baseline(self.img)
        if self.baseline < MIN_CONTRAST:
            raise ActionError("INVALID_CONFIG", "A imagem de referência é quase lisa (sem detalhes); ela casaria com qualquer área parecida. Recorte um trecho com contraste.", {"contrast": round(self.baseline, 2)})

    @staticmethod
    def _baseline(img: Any) -> float:
        Image, ImageChops, ImageStat = _pil()
        flat = Image.new("L", img.size, round(ImageStat.Stat(img).mean[0]))
        return float(ImageStat.Stat(ImageChops.difference(img, flat)).mean[0])


def _score(screen: Any, tpl: Any, baseline: float, x: int, y: int) -> float:
    _, ImageChops, ImageStat = _pil()
    box = (x, y, x + tpl.size[0], y + tpl.size[1])
    mad = ImageStat.Stat(ImageChops.difference(screen.crop(box), tpl)).mean[0]
    return max(0.0, 1.0 - mad / max(baseline, 1e-6))


def find_image(screen: Any, template: Template, threshold: float, tick: Callable[[], None] = lambda: None) -> tuple[Optional[Found], float]:
    """(melhor casamento ≥ limiar ou None, melhor similaridade vista). Coordenadas relativas à `screen`."""
    sw, sh = screen.size
    tw, th = template.width, template.height
    if tw > sw or th > sh:
        return None, 0.0
    gray = screen.convert("L")
    f = max(1, min(8, min(tw, th) // MIN_SIDE))
    if f > 1:
        small, tpl_small = gray.reduce(f), template.img.reduce(f)
    else:
        small, tpl_small = gray, template.img
    base_small = Template._baseline(tpl_small)
    cw, ch = small.size[0] - tpl_small.size[0] + 1, small.size[1] - tpl_small.size[1] + 1
    # passo da grade grossa: respeita o orçamento, mas nunca pula mais que 1/4 do modelo reduzido (senão perderia o pico)
    step = max(1, min(math.ceil(math.sqrt(max(1, cw * ch) / COARSE_BUDGET)), min(tpl_small.size) // 4))

    scored: list[tuple[float, int, int]] = []
    for cy in range(0, ch, step):
        tick()
        for cx in range(0, cw, step):
            scored.append((_score(small, tpl_small, base_small, cx, cy), cx, cy))
    scored.sort(reverse=True)
    picks: list[tuple[float, int, int]] = []
    for s, cx, cy in scored:  # candidatos distintos (não 6 vizinhos do mesmo pico)
        if all(abs(cx - px) > 2 * step or abs(cy - py) > 2 * step for _, px, py in picks):
            picks.append((s, cx, cy))
            if len(picks) == CANDIDATES:
                break

    reach = step * f + f  # a grade grossa pode ter errado por até isso (em pixels cheios)
    best: Optional[Found] = None
    for _, cx, cy in picks:
        tick()
        x0, y0 = cx * f, cy * f
        for y in range(max(0, y0 - reach), min(sh - th, y0 + reach) + 1):
            for x in range(max(0, x0 - reach), min(sw - tw, x0 + reach) + 1):
                s = _score(gray, template.img, template.baseline, x, y)
                if best is None or s > best.similarity:
                    best = Found(round(s, 3), x, y)
    seen = best.similarity if best else 0.0
    return (best if best and best.similarity >= threshold else None), seen


def load_template(path_value: str) -> Template:
    Image, _, _ = _pil()
    path = resolve_path(path_value, "Imagem de referência")
    if os.path.splitext(path)[1].lower() not in IMAGE_EXTENSIONS:
        raise ActionError("INVALID_CONFIG", f"A imagem de referência deve ser {', '.join(IMAGE_EXTENSIONS)}.", {"path": path})
    try:
        size = os.path.getsize(path)
    except OSError:
        raise ActionError("PATH_NOT_FOUND", f"A imagem de referência não existe: {path}", {"path": path}) from None
    if not os.path.isfile(path):
        raise ActionError("PATH_NOT_FOUND", f"A imagem de referência não é um arquivo: {path}", {"path": path})
    if size > MAX_FILE_BYTES:
        raise ActionError("INVALID_CONFIG", f"A imagem tem {size // 1024} KB; o máximo é {MAX_FILE_BYTES // 1024} KB.", {"path": path, "bytes": size})
    try:
        with Image.open(path) as im:
            im.load()
            img = im.copy()
    except Exception as e:  # Pillow lança vários tipos para arquivo corrompido/formato falso
        raise ActionError("INVALID_CONFIG", f"Não consegui ler a imagem de referência ({type(e).__name__}): {path}", {"path": path}) from None
    w, h = img.size
    if not (MIN_SIDE <= w <= MAX_SIDE and MIN_SIDE <= h <= MAX_SIDE):
        raise ActionError("INVALID_CONFIG", f"A imagem tem {w}×{h} px; cada lado deve ter entre {MIN_SIDE} e {MAX_SIDE}.", {"width": w, "height": h})
    return Template(img)


@action("vision.find_image")
def find_image_action(ctx: ActionContext) -> dict[str, Any]:
    raw = ctx.config.get("imagePath")
    if not isinstance(raw, str) or not raw.strip():
        raise ActionError("INVALID_CONFIG", "O campo “Imagem de referência” é obrigatório.", {"field": "imagePath"})
    similarity = _num(ctx, "similarity", "Similaridade mínima", 0.9, 0.5, 1.0)
    timeout = _num(ctx, "timeoutSeconds", "Esperar até (s)", 10, 0, 3600)
    region = _region(ctx)
    if _screen is None:  # sem tela de teste, só existe no Windows (checado antes de abrir o arquivo)
        require_windows("Localizar imagem na tela")
    template = load_template(raw)
    screen = _screen if _screen is not None else WindowsScreen()
    ox, oy = (region[0], region[1]) if region else (0, 0)

    deadline = time.monotonic() + timeout
    attempts = 0
    best_seen = 0.0
    while True:
        ctx.check_cancelled()
        attempts += 1
        found, seen = find_image(screen.capture(region), template, similarity, ctx.check_cancelled)
        best_seen = max(best_seen, seen)
        if found:
            x, y = found.x + ox, found.y + oy
            cx, cy = x + template.width // 2, y + template.height // 2
            return {
                "outputs": {"x": x, "y": y, "width": template.width, "height": template.height, "centerX": cx, "centerY": cy, "similarity": found.similarity, "attempts": attempts},
                "message": f"Achei a imagem em ({cx}, {cy}) com similaridade {found.similarity:.2f}.",
            }
        if time.monotonic() >= deadline:
            break
        ctx.sleep(min(POLL_SECONDS, max(0.0, deadline - time.monotonic())))
    raise ActionError(
        "IMAGE_NOT_FOUND_ON_SCREEN",
        f"Não encontrei a imagem de referência na tela em {timeout:g} s (similaridade mínima {similarity:.2f}; a melhor foi {best_seen:.2f}). "
        "Confira se ela está visível, na mesma escala (DPI/zoom) e tema do recorte, ou abaixe a similaridade.",
        {"similarity": similarity, "bestSimilarity": round(best_seen, 3), "attempts": attempts, "timeoutSeconds": timeout},
    )
