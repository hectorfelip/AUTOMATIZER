#!/usr/bin/env python3
"""SPIKE (Fase 8, ADR 0015): o Windows.Media.Ocr funciona aqui, com que idioma, velocidade e precisão?

ESBOÇO NÃO EXECUTADO: foi escrito sem acesso a um Windows e os nomes dos pacotes `winrt-*` podem precisar de ajuste.

Uso (Windows, PowerShell):
    python -m pip install pyautogui pillow winrt-runtime winrt-Windows.Media.Ocr winrt-Windows.Graphics.Imaging ^
        winrt-Windows.Storage winrt-Windows.Storage.Streams winrt-Windows.Globalization winrt-Windows.Foundation ^
        winrt-Windows.Foundation.Collections
    python scripts\\spike-ocr.py            # captura a tela inteira e lê o texto
    python scripts\\spike-ocr.py imagem.png # lê uma imagem existente
Deixe uma janela com texto (ex.: este terminal, o Bloco de Notas com uma frase) visível antes de rodar.
"""

import asyncio
import os
import sys
import tempfile
import time


async def ocr(path: str) -> None:
    from winrt.windows.globalization import Language
    from winrt.windows.graphics.imaging import BitmapDecoder
    from winrt.windows.media.ocr import OcrEngine
    from winrt.windows.storage import FileAccessMode, StorageFile

    print(f"[ocr] idiomas disponíveis: {[l.language_tag for l in OcrEngine.available_recognizer_languages]}")
    engine = OcrEngine.try_create_from_user_profile_languages()
    if engine is None:
        engine = OcrEngine.try_create_from_language(Language("pt-BR")) or OcrEngine.try_create_from_language(Language("en-US"))
    if engine is None:
        print("[ocr] FALHA: nenhum idioma de OCR instalado (Configurações > Hora e idioma > Idioma > adicionar idioma).")
        return
    print(f"[ocr] motor: {engine.recognizer_language.language_tag}")
    file = await StorageFile.get_file_from_path_async(os.path.abspath(path))
    stream = await file.open_async(FileAccessMode.READ)
    decoder = await BitmapDecoder.create_async(stream)
    bitmap = await decoder.get_software_bitmap_async()
    t0 = time.monotonic()
    result = await engine.recognize_async(bitmap)
    dt = time.monotonic() - t0
    print(f"[ocr] OK em {dt:.2f} s — {len(result.lines)} linha(s), {sum(len(l.words) for l in result.lines)} palavra(s)")
    for line in list(result.lines)[:15]:
        words = list(line.words)
        box = words[0].bounding_rect if words else None
        where = f" @({int(box.x)},{int(box.y)})" if box else ""
        print(f"[ocr]   {line.text}{where}")

def _diag() -> None:
    import platform
    print(f"[diag] Python {sys.version.split()[0]} ({platform.architecture()[0]}) em {platform.platform()}")
    print(f"[diag] executável: {sys.executable}")


def main() -> int:
    _diag()
    if sys.platform != "win32":
        print("[ocr] este spike só roda no Windows.")
        return 2
    if len(sys.argv) > 1:
        path = sys.argv[1]
    else:
        import pyautogui

        path = os.path.join(tempfile.gettempdir(), "as-spike-ocr.png")
        pyautogui.screenshot(path)
        print(f"[ocr] captura da tela salva em {path}")
    try:
        asyncio.run(ocr(path))
    except ImportError as e:
        import traceback

        traceback.print_exc()
        print(f"[ocr] FALHA de import: {e}")
        print("[ocr] Os pacotes `winrt-*` podem não ter versão para o seu Python (ex.: 3.14). Confira com: python -m pip install winrt-runtime")
        print("[ocr] Alternativa: instale o Python 3.12/3.13 num venv só para este teste (py -3.12 -m venv .venv-spike).")
        return 1
    except Exception as e:  # noqa: BLE001
        import traceback

        traceback.print_exc()
        print(f"[ocr] FALHA: {type(e).__name__}: {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
