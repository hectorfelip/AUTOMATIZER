"""Visão: localizar TEXTO na tela por OCR (Windows.Media.Ocr). ADR 0015.

Ordem de preferência da automação: UIA > janela > navegador > **imagem/OCR** > coordenadas. Use quando não há elemento.
O motor de OCR não devolve confiança por palavra; o "limiar" é uma SIMILARIDADE de texto (0–1) entre o procurado e o lido,
o que tolera o ruído típico de texto pequeno de interface.

Backend injetável (`set_backend`): os testes usam um falso; no Windows, `WindowsBackend` (captura + Windows.Media.Ocr).
"""

from __future__ import annotations

import difflib
import os
import sys
import tempfile
import time
import unicodedata
from dataclasses import dataclass
from typing import Any, Optional, Protocol

from ..runtime.context import ActionContext, ActionError
from ..runtime.registry import action
from .windows import dependency_missing, require_windows

MAX_TEXT = 200
POLL_SECONDS = 0.5


@dataclass(frozen=True)
class Word:
    text: str
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class Line:
    text: str
    words: tuple[Word, ...]


class Backend(Protocol):
    def read(self, region: Optional[tuple[int, int, int, int]]) -> list[Line]:
        """Captura a tela (ou a região x,y,largura,altura) e devolve as linhas lidas, em coordenadas ABSOLUTAS da tela."""


_backend: Optional[Backend] = None


def set_backend(b: Optional[Backend]) -> None:
    global _backend
    _backend = b


# ---- casamento de texto (puro, testável em qualquer SO) ----
def normalize(s: str) -> str:
    """Minúsculas, sem acentos, espaços colapsados: 'Salvar  Como' ~ 'salvar como'."""
    d = unicodedata.normalize("NFKD", s.casefold())
    return " ".join("".join(c for c in d if not unicodedata.combining(c)).split())


@dataclass(frozen=True)
class Match:
    text: str
    similarity: float
    x: int
    y: int
    width: int
    height: int

    @property
    def center(self) -> tuple[int, int]:
        return self.x + self.width // 2, self.y + self.height // 2


def find_best(lines: list[Line], query: str, threshold: float) -> Optional[Match]:
    """Melhor trecho (janela de palavras consecutivas de uma linha) com similaridade ≥ `threshold`."""
    q = normalize(query)
    if not q:
        return None
    n = len(q.split())
    best: Optional[Match] = None
    for line in lines:
        words = line.words
        if not words:
            continue
        for size in {max(1, n - 1), n, n + 1}:  # tolera uma palavra a mais/menos (OCR junta ou separa)
            for i in range(0, len(words) - size + 1):
                chunk = words[i : i + size]
                cand = normalize(" ".join(w.text for w in chunk))
                sim = 1.0 if cand == q else difflib.SequenceMatcher(None, q, cand).ratio()
                if sim >= threshold and (best is None or sim > best.similarity):
                    x0 = min(w.x for w in chunk)
                    y0 = min(w.y for w in chunk)
                    x1 = max(w.x + w.width for w in chunk)
                    y1 = max(w.y + w.height for w in chunk)
                    best = Match(" ".join(w.text for w in chunk), round(sim, 3), x0, y0, x1 - x0, y1 - y0)
    return best


# ---- backend real (Windows) ----
class WindowsBackend:
    def read(self, region: Optional[tuple[int, int, int, int]]) -> list[Line]:
        try:
            import pyautogui  # type: ignore[import-not-found]
        except ImportError as e:
            raise dependency_missing("pyautogui", e) from None
        try:
            import asyncio

            from winrt.windows.globalization import Language  # type: ignore[import-not-found]
            from winrt.windows.graphics.imaging import BitmapDecoder  # type: ignore[import-not-found]
            from winrt.windows.media.ocr import OcrEngine  # type: ignore[import-not-found]
            from winrt.windows.storage import FileAccessMode, StorageFile  # type: ignore[import-not-found]
        except ImportError as e:
            raise ActionError(
                "DEPENDENCY_MISSING",
                f"As bibliotecas de OCR não puderam ser carregadas ({type(e).__name__}: {str(e)[:150]}). Instale no Python do motor ({sys.executable}) com: "
                "python -m pip install -r engine/python/requirements-vision.txt",
                {"python": sys.executable},
            ) from None

        engine = OcrEngine.try_create_from_user_profile_languages() or OcrEngine.try_create_from_language(Language("pt-BR")) or OcrEngine.try_create_from_language(Language("en-US"))
        if engine is None:
            raise ActionError("OCR_LANGUAGE_MISSING", "Nenhum idioma de OCR está instalado no Windows (Configurações > Hora e idioma > Idioma).")

        ox, oy = (region[0], region[1]) if region else (0, 0)
        path = os.path.join(tempfile.gettempdir(), f"as-ocr-{os.getpid()}-{threading_id()}.png")
        try:
            img = pyautogui.screenshot(region=region) if region else pyautogui.screenshot()
            img.save(path)

            async def go() -> Any:
                f = await StorageFile.get_file_from_path_async(path)
                stream = await f.open_async(FileAccessMode.READ)
                decoder = await BitmapDecoder.create_async(stream)
                bmp = await decoder.get_software_bitmap_async()
                return await engine.recognize_async(bmp)

            result = asyncio.run(go())
            lines: list[Line] = []
            for ln in result.lines:
                ws = tuple(Word(w.text, int(w.bounding_rect.x) + ox, int(w.bounding_rect.y) + oy, int(w.bounding_rect.width), int(w.bounding_rect.height)) for w in ln.words)
                lines.append(Line(ln.text, ws))
            return lines
        finally:
            try:
                os.remove(path)
            except OSError:
                pass


def threading_id() -> int:
    import threading

    return threading.get_ident()


def _get_backend() -> Backend:
    return _backend if _backend is not None else WindowsBackend()


# ---- validação ----
def _num(ctx: ActionContext, key: str, label: str, default: float, lo: float, hi: float) -> float:
    v = ctx.config.get(key, default)
    if v is None or v == "":
        v = default
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        raise ActionError("INVALID_CONFIG", f"“{label}” deve ser um número entre {lo:g} e {hi:g}.", {"field": key, "value": v})
    return float(v)


def _region(ctx: ActionContext) -> Optional[tuple[int, int, int, int]]:
    vals = []
    for key, label in (("regionX", "Região X"), ("regionY", "Região Y"), ("regionWidth", "Região largura"), ("regionHeight", "Região altura")):
        v = ctx.config.get(key)
        vals.append(0 if v is None or v == "" else v)
        if isinstance(vals[-1], bool) or not isinstance(vals[-1], (int, float)) or vals[-1] < 0 or float(vals[-1]) != int(vals[-1]):
            raise ActionError("INVALID_CONFIG", f"“{label}” deve ser um número inteiro, zero ou maior.", {"field": key, "value": v})
    x, y, w, h = (int(v) for v in vals)
    if w == 0 and h == 0:
        if x or y:
            raise ActionError("INVALID_CONFIG", "Para limitar a busca a uma região, informe também largura e altura (a tela inteira é o padrão).")
        return None
    if w == 0 or h == 0:
        raise ActionError("INVALID_CONFIG", "A região precisa de largura e altura maiores que zero.", {"width": w, "height": h})
    return x, y, w, h


@action("vision.find_text")
def find_text(ctx: ActionContext) -> dict[str, Any]:
    query = ctx.config.get("text")
    if isinstance(query, (int, float)) and not isinstance(query, bool):
        query = str(query)
    if not isinstance(query, str) or not query.strip():
        raise ActionError("INVALID_CONFIG", "O campo “Texto a procurar” é obrigatório.", {"field": "text"})
    if len(query) > MAX_TEXT:
        raise ActionError("INVALID_CONFIG", f"O texto tem {len(query)} caracteres; o máximo é {MAX_TEXT}.", {"length": len(query)})
    similarity = _num(ctx, "similarity", "Similaridade mínima", 0.8, 0.3, 1.0)
    timeout = _num(ctx, "timeoutSeconds", "Esperar até (s)", 10, 0, 3600)
    region = _region(ctx)
    if _backend is None:  # sem backend de teste, só existe no Windows
        require_windows("Localizar texto na tela")
    backend = _get_backend()

    deadline = time.monotonic() + timeout
    attempts = 0
    best_seen = 0.0
    while True:
        ctx.check_cancelled()
        attempts += 1
        lines = backend.read(region)
        m = find_best(lines, query, similarity)
        if m:
            cx, cy = m.center
            return {
                "outputs": {"x": m.x, "y": m.y, "width": m.width, "height": m.height, "centerX": cx, "centerY": cy, "matchedText": m.text, "similarity": m.similarity, "attempts": attempts},
                "message": f"Achei “{m.text}” em ({cx}, {cy}) com similaridade {m.similarity:.2f}.",
            }
        closest = find_best(lines, query, 0.0)
        if closest:
            best_seen = max(best_seen, closest.similarity)
        if time.monotonic() >= deadline:
            break
        ctx.sleep(min(POLL_SECONDS, max(0.0, deadline - time.monotonic())))
    # a mensagem NÃO repete o que foi lido na tela (pode ser dado sensível); só o que o usuário procurou
    raise ActionError(
        "TEXT_NOT_FOUND_ON_SCREEN",
        f"Não encontrei “{query[:60]}” na tela em {timeout:g} s (similaridade mínima {similarity:.2f}; a melhor foi {best_seen:.2f}). "
        "Abaixe a similaridade, confira se o texto está visível e no idioma do OCR, ou limite a busca a uma região.",
        {"text": query[:60], "similarity": similarity, "bestSimilarity": round(best_seen, 3), "attempts": attempts, "timeoutSeconds": timeout},
    )
