"""Teclado e mouse (Windows). Última opção na ordem de preferência: UIA > janela > navegador > imagem > coordenadas."""

import re
from typing import Any

from ..runtime.context import ActionContext, ActionError
from ..runtime.registry import action
from .windows import require_windows

MAX_TYPED = 5000
_SEND_KEYS_SPECIAL = {"{": "{{}", "}": "{}}", "+": "{+}", "^": "{^}", "%": "{%}", "~": "{~}", "(": "{(}", ")": "{)}"}
MODIFIERS = ("ctrl", "alt", "shift", "win")
_ALIASES = {"control": "ctrl", "windows": "win", "cmd": "win", "escape": "esc", "return": "enter", "del": "delete", "pgup": "pageup", "pgdn": "pagedown"}
_NAMED = {"enter", "tab", "esc", "space", "backspace", "delete", "insert", "home", "end", "pageup", "pagedown", "up", "down", "left", "right", "printscreen", *(f"f{i}" for i in range(1, 25))}


def escape_send_keys(text: str) -> str:
    """Escapa os caracteres que o `send_keys` do pywinauto trata como comando (+ ^ % ~ ( ) { })."""
    return "".join(_SEND_KEYS_SPECIAL.get(c, c) for c in text)


def parse_hotkey(text: str) -> list[str]:
    """"Ctrl + Shift+S" → ["ctrl", "shift", "s"] (modificadores primeiro). Valida cada tecla."""
    tokens = [t.strip().lower() for t in text.split("+")]
    if not text.strip() or any(not t for t in tokens):
        raise ActionError("INVALID_CONFIG", "Informe as teclas separadas por “+” (ex.: ctrl+s).", {"keys": text})
    keys = [_ALIASES.get(t, t) for t in tokens]
    for k in keys:
        if k not in MODIFIERS and k not in _NAMED and not re.fullmatch(r"[a-z0-9]", k):
            raise ActionError("INVALID_CONFIG", f"Tecla desconhecida: “{k}”. Exemplos: ctrl, alt, shift, win, enter, esc, f5, a, 7.", {"key": k})
    mods = [k for k in keys if k in MODIFIERS]
    main = [k for k in keys if k not in MODIFIERS]
    if len(main) != 1:
        raise ActionError("INVALID_CONFIG", "Use exatamente uma tecla principal (além de ctrl/alt/shift/win), ex.: ctrl+shift+esc.", {"keys": text})
    if len(set(mods)) != len(mods):
        raise ActionError("INVALID_CONFIG", "Há um modificador repetido nas teclas.", {"keys": text})
    return mods + main


def _pyautogui() -> Any:
    try:
        import pyautogui  # type: ignore[import-not-found]
    except ImportError:
        raise ActionError("DEPENDENCY_MISSING", "A biblioteca pyautogui não está disponível neste motor.") from None
    except Exception as e:  # noqa: BLE001 - ex.: sessão sem tela
        raise ActionError("DEPENDENCY_UNAVAILABLE", f"Não foi possível usar o teclado/mouse neste ambiente: {e}") from None
    pyautogui.FAILSAFE = True  # mouse no canto da tela = parada de emergência
    pyautogui.PAUSE = 0.05
    return pyautogui


def _failsafe(pyautogui: Any) -> ActionError:
    return ActionError("FAILSAFE_TRIGGERED", "Interrompido: o mouse foi levado ao canto da tela (parada de emergência).")


@action("input.type_text")
def type_text(ctx: ActionContext) -> dict[str, Any]:
    text = ctx.config.get("text")
    if isinstance(text, (int, float)) and not isinstance(text, bool):
        text = str(text)
    if not isinstance(text, str) or text == "":
        raise ActionError("INVALID_CONFIG", "O campo “Texto” é obrigatório.", {"field": "text"})
    if len(text) > MAX_TYPED:
        raise ActionError("INVALID_CONFIG", f"O texto tem {len(text)} caracteres; o máximo é {MAX_TYPED}.", {"length": len(text)})
    require_windows("Digitar texto")
    try:
        from pywinauto.keyboard import send_keys  # type: ignore[import-not-found]
    except ImportError:
        raise ActionError("DEPENDENCY_MISSING", "A biblioteca pywinauto não está disponível neste motor.") from None
    for i in range(0, len(text), 40):  # em blocos, para o cancelamento poder interromper no meio
        ctx.check_cancelled()
        send_keys(escape_send_keys(text[i : i + 40]), with_spaces=True, with_tabs=True, with_newlines=True, pause=0.01)
    return {"outputs": {"length": len(text)}, "message": f"Digitei {len(text)} caractere(s) na janela ativa."}


@action("input.hotkey")
def hotkey(ctx: ActionContext) -> dict[str, Any]:
    keys = parse_hotkey(str(ctx.config.get("keys") or ""))
    require_windows("Atalho de teclado")
    pg = _pyautogui()
    try:
        pg.hotkey(*keys, interval=0.05)
    except pg.FailSafeException:
        raise _failsafe(pg) from None
    return {"outputs": {"keys": keys}, "message": f"Atalho {'+'.join(keys)} enviado."}


@action("input.click")
def click(ctx: ActionContext) -> dict[str, Any]:
    coords: dict[str, int] = {}
    for key in ("x", "y"):
        v = ctx.config.get(key)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not float(v).is_integer() or v < 0:
            raise ActionError("INVALID_CONFIG", f"“{key.upper()}” deve ser um número inteiro, zero ou maior.", {"field": key, "value": v})
        coords[key] = int(v)
    button = ctx.config.get("button") or "left"
    if button not in ("left", "right", "double"):
        raise ActionError("INVALID_CONFIG", "“Botão” deve ser esquerdo, direito ou duplo clique.", {"button": button})
    require_windows("Clique")
    pg = _pyautogui()
    width, height = pg.size()
    if coords["x"] >= width or coords["y"] >= height:
        raise ActionError(
            "COORDINATES_OUT_OF_SCREEN",
            f"A posição ({coords['x']}, {coords['y']}) está fora da tela ({width}x{height}). As coordenadas dependem da resolução e da escala do monitor.",
            {**coords, "screen": [width, height]},
        )
    try:
        pg.click(x=coords["x"], y=coords["y"], button="right" if button == "right" else "left", clicks=2 if button == "double" else 1, interval=0.1)
    except pg.FailSafeException:
        raise _failsafe(pg) from None
    return {"outputs": {**coords, "button": button}, "message": f"Cliquei em ({coords['x']}, {coords['y']})."}
