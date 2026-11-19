"""Clicar em um ELEMENTO de uma janela pelo nome/tipo (UI Automation). Preferência da arquitetura: UIA > janela > OCR > coordenadas.

O clique em si é feito com `pyautogui` no centro do elemento (como `input.click`): mantém a parada de emergência (failsafe).
Backend injetável (`set_backend`): os testes usam elementos falsos; no Windows, `PywinautoBackend`.
"""

from __future__ import annotations


import time
from dataclasses import dataclass
from typing import Any, Optional, Protocol

from ..runtime.context import ActionContext, ActionError
from ..runtime.registry import action
from .input import _failsafe, _pyautogui
from .vision import normalize
from .windows import dependency_missing, require_windows

CONTROL_TYPES = ("", "Button", "CheckBox", "ComboBox", "Edit", "Hyperlink", "ListItem", "MenuItem", "RadioButton", "TabItem", "Text", "TreeItem")
POLL_SECONDS = 0.5


@dataclass(frozen=True)
class Element:
    name: str
    control_type: str
    automation_id: str
    left: int
    top: int
    right: int
    bottom: int

    @property
    def center(self) -> tuple[int, int]:
        return (self.left + self.right) // 2, (self.top + self.bottom) // 2


class Backend(Protocol):
    def window_exists(self, window_title: str) -> bool: ...

    def elements(self, window_title: str, control_type: str) -> list[Element]:
        """Elementos VISÍVEIS (com área) da primeira janela cujo título contém `window_title`, em ordem de tela."""


_backend: Optional[Backend] = None


def set_backend(b: Optional[Backend]) -> None:
    global _backend
    _backend = b


def match(elements: list[Element], name: str, automation_id: str, control_type: str) -> list[Element]:
    """Filtra por nome (contém, sem caixa/acentos), id (exato) e tipo (exato, sem caixa). Ordem de tela: cima→baixo, esquerda→direita."""
    nn = normalize(name)
    out = []
    for e in elements:
        if control_type and e.control_type.lower() != control_type.lower():
            continue
        if automation_id and e.automation_id != automation_id:
            continue
        if nn and nn not in normalize(e.name):
            continue
        out.append(e)
    return sorted(out, key=lambda e: (e.top, e.left))


class PywinautoBackend:
    def _window(self, title: str) -> Any:
        try:
            from pywinauto import Desktop  # type: ignore[import-not-found]
        except ImportError as e:
            raise dependency_missing("pywinauto", e) from None
        needle = title.lower()
        for w in Desktop(backend="uia").windows():  # só janelas visíveis de nível superior
            try:
                if needle in (w.window_text() or "").lower():
                    return w
            except Exception:  # noqa: BLE001 - janela que some durante a enumeração
                continue
        return None

    def window_exists(self, window_title: str) -> bool:
        return self._window(window_title) is not None

    def elements(self, window_title: str, control_type: str) -> list[Element]:
        w = self._window(window_title)
        if w is None:
            return []
        out: list[Element] = []
        try:
            found = w.descendants(control_type=control_type) if control_type else w.descendants()
        except Exception:  # noqa: BLE001 - janela mudou durante a leitura: tenta de novo na próxima volta
            return []
        for el in found:
            try:
                r = el.rectangle()
                if r.width() <= 0 or r.height() <= 0 or not el.is_visible():
                    continue
                info = el.element_info
                out.append(Element(el.window_text() or "", info.control_type or "", info.automation_id or "", r.left, r.top, r.right, r.bottom))
            except Exception:  # noqa: BLE001 - elemento que sumiu
                continue
        return out


def _text(ctx: ActionContext, key: str, label: str, limit: int = 300) -> str:
    v = ctx.config.get(key)
    if v is None or v == "":
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    if not isinstance(v, str):
        raise ActionError("INVALID_CONFIG", f"O campo “{label}” deve ser um texto.", {"field": key})
    if len(v) > limit:
        raise ActionError("INVALID_CONFIG", f"O campo “{label}” tem {len(v)} caracteres; o máximo é {limit}.", {"field": key})
    return v.strip()


@action("windows.click_element")
def click_element(ctx: ActionContext) -> dict[str, Any]:
    window = _text(ctx, "windowTitle", "Título da janela")
    if not window:
        raise ActionError("INVALID_CONFIG", "O campo “Título da janela” é obrigatório.", {"field": "windowTitle"})
    name = _text(ctx, "elementName", "Nome do elemento")
    aid = _text(ctx, "automationId", "AutomationId", 200)
    ctype = _text(ctx, "controlType", "Tipo do elemento", 40)
    if not name and not aid:
        raise ActionError("INVALID_CONFIG", "Informe o nome do elemento ou o AutomationId.", {"fields": ["elementName", "automationId"]})
    if ctype not in CONTROL_TYPES:
        raise ActionError("INVALID_CONFIG", f"Tipo de elemento desconhecido: “{ctype}”. Use um destes: {', '.join(t for t in CONTROL_TYPES if t)}.", {"controlType": ctype})
    index = ctx.config.get("index", 1)
    index = 1 if index is None or index == "" else index
    if isinstance(index, bool) or not isinstance(index, (int, float)) or index < 1 or float(index) != int(index):
        raise ActionError("INVALID_CONFIG", "“Posição” deve ser um número inteiro, 1 ou maior.", {"index": index})
    index = int(index)
    timeout = ctx.config.get("timeoutSeconds", 10)
    timeout = 10 if timeout is None or timeout == "" else timeout
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 <= timeout <= 3600:
        raise ActionError("INVALID_CONFIG", "“Esperar até (s)” deve ser um número entre 0 e 3600.", {"timeoutSeconds": timeout})
    button = ctx.config.get("button") or "left"
    if button not in ("left", "right", "double"):
        raise ActionError("INVALID_CONFIG", "“Botão” deve ser esquerdo, direito ou duplo clique.", {"button": button})
    if _backend is None:
        require_windows("Clicar em elemento")
    backend: Backend = _backend if _backend is not None else PywinautoBackend()

    deadline = time.monotonic() + float(timeout)
    target: Optional[Element] = None
    window_seen = False
    while True:
        ctx.check_cancelled()
        window_seen = backend.window_exists(window) or window_seen
        if window_seen:
            found = match(backend.elements(window, ctype), name, aid, ctype)
            if len(found) >= index:
                target = found[index - 1]
                break
        if time.monotonic() >= deadline:
            break
        ctx.sleep(min(POLL_SECONDS, max(0.0, deadline - time.monotonic())))
    what = f"“{name}”" if name else f"AutomationId “{aid}”"
    if not window_seen:
        raise ActionError("WINDOW_NOT_FOUND", f"Não encontrei uma janela com “{window}” no título (esperei {float(timeout):g}s). Use “Ativar janela” antes ou confira o título.", {"windowTitle": window})
    if target is None:
        raise ActionError(
            "ELEMENT_NOT_FOUND",
            f"Não encontrei o elemento {what}{f' (tipo {ctype})' if ctype else ''} na janela “{window}” em {float(timeout):g}s"
            f"{f' (posição {index})' if index > 1 else ''}. Confira o nome, o tipo ou aumente o tempo de espera; para ver os nomes, use uma ferramenta como o Accessibility Insights.",
            {"windowTitle": window, "elementName": name, "automationId": aid, "controlType": ctype, "index": index},
        )

    cx, cy = target.center
    ctx.check_cancelled()
    pg = _pyautogui()
    width, height = pg.size()
    if cx >= width or cy >= height or cx < 0 or cy < 0:
        raise ActionError("COORDINATES_OUT_OF_SCREEN", f"O elemento está fora da tela ({cx}, {cy}); a tela é {width}x{height}. Traga a janela para a tela e tente de novo.", {"x": cx, "y": cy, "screen": [width, height]})
    try:
        pg.click(x=cx, y=cy, button="right" if button == "right" else "left", clicks=2 if button == "double" else 1, interval=0.1)
    except pg.FailSafeException:
        raise _failsafe(pg) from None
    return {
        "outputs": {"x": cx, "y": cy, "name": target.name, "controlType": target.control_type},
        "message": f"Cliquei em “{target.name or target.automation_id}” ({target.control_type or 'elemento'}) em ({cx}, {cy}).",
    }



