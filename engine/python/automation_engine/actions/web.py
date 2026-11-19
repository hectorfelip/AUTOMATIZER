"""Automação web (Playwright). Preferência: seletores/elementos, nunca coordenadas de tela.

Modelo: UMA thread dedicada é dona do Playwright (a API síncrona é presa à thread que a criou, e o motor roda cada
ação numa thread nova). Cada execução tem a sua sessão (navegador + página), criada por `web.navigate` e fechada
por `web.close`, ao fim da execução (gancho do motor) ou por inatividade. As esperas são fatiadas em pedaços curtos
para o cancelamento valer na hora; só a navegação (`goto`) espera terminar ou estourar o tempo.
"""

from __future__ import annotations

import os
import queue
import sys
import threading
import time
from concurrent.futures import Future
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from ..runtime import registry
from ..runtime.context import ActionCancelled, ActionContext, ActionError
from ..runtime.registry import action

SLICE_MS = 400  # fatia de espera: é o atraso máximo para perceber um cancelamento
IDLE_CLOSE_S = 600  # sessão esquecida (fluxo travado, app caiu) fecha sozinha
MAX_ITEMS = 200
MAX_TEXT = 2000
NAV_TIMEOUT_MAX = 120


def _playwright_error(e: Exception) -> ActionError:
    return ActionError("BROWSER_ERROR", f"Erro do navegador: {str(e).splitlines()[0][:300]}", {"type": type(e).__name__})


class _Session:
    def __init__(self, browser: Any, context: Any, page: Any) -> None:
        self.browser, self.context, self.page = browser, context, page
        self.last_used = time.monotonic()


class _Worker:
    """Dono do Playwright. Tudo que toca o navegador roda aqui, uma operação por vez."""

    def __init__(self) -> None:
        self._q: "queue.Queue[tuple[Callable[[], Any], Future[Any]] | None]" = queue.Queue()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._pw: Any = None
        self.sessions: dict[str, _Session] = {}

    # ---- fila ----
    def _ensure_thread(self) -> None:
        with self._lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._loop, daemon=True, name="web-worker")
                self._thread.start()

    def _loop(self) -> None:
        while True:
            try:
                item = self._q.get(timeout=30)
            except queue.Empty:
                self._close_idle()
                continue
            if item is None:
                self._close_all()
                return
            fn, fut = item
            if not fut.set_running_or_notify_cancel():
                continue
            try:
                fut.set_result(fn())
            except BaseException as e:  # noqa: BLE001 - devolve ao chamador, que traduz
                fut.set_exception(e)

    def submit(self, fn: Callable[[], Any]) -> "Future[Any]":
        self._ensure_thread()
        fut: "Future[Any]" = Future()
        self._q.put((fn, fut))
        return fut

    def call(self, ctx: ActionContext, fn: Callable[[], Any]) -> Any:
        """Executa `fn` na thread do navegador, acordando a cada fatia para perceber o cancelamento."""
        fut = self.submit(fn)
        while True:
            try:
                return fut.result(timeout=0.1)
            except TimeoutError:
                if ctx.cancelled:
                    fut.cancel()  # se ainda não começou, nem executa
                    raise ActionCancelled() from None

    # ---- ciclo de vida (só na thread do worker) ----
    def _playwright(self) -> Any:
        if self._pw is None:
            try:
                from playwright.sync_api import sync_playwright  # type: ignore[import-not-found]
            except ImportError:
                raise ActionError("DEPENDENCY_MISSING", "A biblioteca playwright não está disponível neste motor (veja engine/python/requirements-web.txt).") from None
            self._pw = sync_playwright().start()
        return self._pw

    def launch(self, headless: bool) -> Any:
        pw = self._playwright()
        args = ["--no-sandbox"] if os.environ.get("AUTOMATION_BROWSER_NO_SANDBOX") == "1" else []  # só para testes em container
        explicit = os.environ.get("AUTOMATION_BROWSER_PATH")  # testes/instalações customizadas
        attempts: list[dict[str, Any]] = []
        if explicit:
            attempts.append({"executable_path": explicit})
        else:
            if sys.platform == "win32":
                attempts += [{"channel": "msedge"}, {"channel": "chrome"}]  # Edge vem com o Windows 11: dispensa embutir o Chromium
            attempts.append({})  # Chromium do próprio Playwright
        last: Optional[Exception] = None
        for kw in attempts:
            try:
                return pw.chromium.launch(headless=headless, args=args, **kw)
            except Exception as e:  # noqa: BLE001
                last = e
        raise ActionError(
            "BROWSER_UNAVAILABLE",
            "Não encontrei um navegador para automatizar (Microsoft Edge, Google Chrome ou o Chromium do Playwright).",
            {"detail": str(last).splitlines()[0][:300] if last else ""},
        )

    def session(self, execution_id: str) -> Optional[_Session]:
        s = self.sessions.get(execution_id)
        if s:
            s.last_used = time.monotonic()
        return s

    def open_session(self, execution_id: str, headless: bool) -> _Session:
        s = self.sessions.get(execution_id)
        if s:
            s.last_used = time.monotonic()
            return s
        browser = self.launch(headless)
        context = browser.new_context(viewport={"width": 1280, "height": 800}, accept_downloads=False, java_script_enabled=True)
        s = _Session(browser, context, context.new_page())
        self.sessions[execution_id] = s
        return s

    def close_session(self, execution_id: str) -> bool:
        s = self.sessions.pop(execution_id, None)
        if not s:
            return False
        try:
            s.browser.close()
        except Exception:  # noqa: BLE001
            pass
        return True

    def _close_idle(self) -> None:
        now = time.monotonic()
        for eid in [k for k, s in self.sessions.items() if now - s.last_used > IDLE_CLOSE_S]:
            self.close_session(eid)

    def _close_all(self) -> None:
        for eid in list(self.sessions):
            self.close_session(eid)
        if self._pw is not None:
            try:
                self._pw.stop()
            except Exception:  # noqa: BLE001
                pass
            self._pw = None

    # ---- chamados de fora (gancho do motor) ----
    def close_execution_async(self, execution_id: str) -> None:
        if self._thread is not None and self._thread.is_alive():  # sem worker não há sessão: nada a fazer
            self.submit(lambda: self.close_session(execution_id))

    def shutdown(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            self._q.put(None)
            self._thread.join(timeout=5)


_worker = _Worker()
registry.on_execution_end(_worker.close_execution_async)
registry.on_shutdown(_worker.shutdown)


# ---- validação ----
def _text(ctx: ActionContext, key: str, label: str, *, required: bool = True, limit: int = 10_000) -> str:
    v = ctx.config.get(key)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    if v is None or v == "":
        if required:
            raise ActionError("INVALID_CONFIG", f"O campo “{label}” é obrigatório.", {"field": key})
        return ""
    if not isinstance(v, str):
        raise ActionError("INVALID_CONFIG", f"O campo “{label}” deve ser um texto.", {"field": key})
    if len(v) > limit:
        raise ActionError("INVALID_CONFIG", f"O campo “{label}” tem {len(v)} caracteres; o máximo é {limit}.", {"field": key})
    return v


def _selector(ctx: ActionContext) -> str:
    return _text(ctx, "selector", "Seletor", limit=1000).strip()


def check_url(url: str) -> str:
    """Só http/https com endereço: nada de file:, javascript:, data: (nem URL sem host)."""
    u = url.strip()
    parts = urlsplit(u)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ActionError("INVALID_CONFIG", "Informe um endereço completo começando com http:// ou https://.", {"url": url[:200]})
    return u


def _seconds(ctx: ActionContext, key: str, default: float, label: str, maximum: float = 3600) -> float:
    v = ctx.config.get(key, default)
    if v is None or v == "":
        v = default
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0 or v > maximum:
        raise ActionError("INVALID_CONFIG", f"“{label}” deve ser um número entre 0 e {maximum:g}.", {"field": key, "value": v})
    return float(v)


def _page(execution_id: str) -> Any:
    s = _worker.session(execution_id)
    if not s:
        raise ActionError("NO_BROWSER", "Nenhuma página aberta nesta execução. Use “Abrir página” antes deste nó.")
    return s.page


def _sliced(ctx: ActionContext, total_s: float, op: Callable[[int], Any], what: str, selector: str) -> Any:
    """Repete `op(timeout_ms)` em fatias curtas até dar certo, estourar o tempo ou cancelarem. Roda NA thread do navegador."""
    from playwright.sync_api import Error as PwError, TimeoutError as PwTimeout  # type: ignore[import-not-found]

    deadline = time.monotonic() + total_s
    while True:
        if ctx.cancelled:
            raise ActionCancelled()
        remaining = deadline - time.monotonic()
        try:
            return op(max(1, min(SLICE_MS, int(remaining * 1000)) if remaining > 0 else 1))
        except PwTimeout:
            if time.monotonic() >= deadline:
                raise ActionError(
                    "ELEMENT_NOT_FOUND",
                    f"{what}: não encontrei o elemento “{selector[:120]}” em {total_s:g} s. Confira o seletor ou aumente o tempo de espera.",
                    {"selector": selector, "timeoutSeconds": total_s},
                ) from None
        except PwError as e:
            raise _playwright_error(e) from None


# ---- ações ----
@action("web.navigate")
def navigate(ctx: ActionContext) -> dict[str, Any]:
    url = check_url(_text(ctx, "url", "Endereço", limit=2000))
    timeout = _seconds(ctx, "timeoutSeconds", 30, "Esperar até (s)", NAV_TIMEOUT_MAX)
    show = ctx.config.get("showBrowser") is True

    def run() -> dict[str, Any]:
        from playwright.sync_api import Error as PwError, TimeoutError as PwTimeout  # type: ignore[import-not-found]

        s = _worker.open_session(ctx.execution_id, headless=not show)
        try:
            resp = s.page.goto(url, timeout=max(1, int(timeout * 1000)), wait_until="load")
        except PwTimeout:
            raise ActionError("NAVIGATION_TIMEOUT", f"A página não terminou de carregar em {timeout:g} s.", {"url": url[:200]}) from None
        except PwError as e:
            raise ActionError("NAVIGATION_FAILED", f"Não foi possível abrir a página: {str(e).splitlines()[0][:200]}", {"url": url[:200]}) from None
        status = resp.status if resp else None
        if status is not None and status >= 400:
            raise ActionError("HTTP_ERROR", f"O servidor respondeu com erro {status}.", {"url": url[:200], "status": status})
        return {"url": s.page.url, "title": s.page.title(), "status": status}

    out = _worker.call(ctx, run)
    return {"outputs": out, "message": f"Abri “{out['title'] or out['url']}”."}


@action("web.click")
def click(ctx: ActionContext) -> dict[str, Any]:
    sel = _selector(ctx)
    total = _seconds(ctx, "timeoutSeconds", 10, "Esperar até (s)")
    page_for = ctx.execution_id

    def run() -> None:
        page = _page(page_for)
        _sliced(ctx, total, lambda ms: page.click(sel, timeout=ms), "Clicar", sel)

    _worker.call(ctx, run)
    return {"outputs": {"selector": sel}, "message": f"Cliquei em “{sel[:80]}”."}


@action("web.fill")
def fill(ctx: ActionContext) -> dict[str, Any]:
    sel = _selector(ctx)
    text = _text(ctx, "text", "Texto", required=False)
    total = _seconds(ctx, "timeoutSeconds", 10, "Esperar até (s)")
    eid = ctx.execution_id

    def run() -> None:
        page = _page(eid)
        _sliced(ctx, total, lambda ms: page.fill(sel, text, timeout=ms), "Preencher", sel)

    _worker.call(ctx, run)
    # a mensagem nunca repete o texto: pode ser senha/dado pessoal e vai para o histórico
    return {"outputs": {"selector": sel, "length": len(text)}, "message": f"Preenchi “{sel[:80]}” ({len(text)} caractere(s))."}


@action("web.extract")
def extract(ctx: ActionContext) -> dict[str, Any]:
    sel = _selector(ctx)
    attr = _text(ctx, "attribute", "Atributo", required=False, limit=100).strip()
    total = _seconds(ctx, "timeoutSeconds", 10, "Esperar até (s)")
    eid = ctx.execution_id

    def run() -> dict[str, Any]:
        from playwright.sync_api import Error as PwError  # type: ignore[import-not-found]

        page = _page(eid)
        loc = page.locator(sel)
        _sliced(ctx, total, lambda ms: loc.first.wait_for(state="attached", timeout=ms), "Extrair", sel)
        count = loc.count()
        items: list[str] = []
        for i in range(min(count, MAX_ITEMS)):
            el = loc.nth(i)
            if not attr:
                v = el.inner_text()
            elif attr == "value":
                try:
                    v = el.input_value()  # valor ATUAL do campo (o atributo HTML guarda só o inicial)
                except PwError:
                    v = el.get_attribute(attr)  # não é campo de formulário
            else:
                v = el.get_attribute(attr)
            items.append((v or "")[:MAX_TEXT])
        return {"text": items[0] if items else "", "items": items, "count": count, "truncated": count > MAX_ITEMS}

    out = _worker.call(ctx, run)
    note = f" (só os primeiros {MAX_ITEMS} foram lidos)" if out["truncated"] else ""
    return {"outputs": out, "message": f"Extraí {out['count']} elemento(s){note}."}


@action("web.wait")
def wait(ctx: ActionContext) -> dict[str, Any]:
    sel = _selector(ctx)
    state = ctx.config.get("state") or "visible"
    if state not in ("visible", "hidden", "attached", "detached"):
        raise ActionError("INVALID_CONFIG", "“Estado” deve ser visível, oculto, presente ou removido.", {"state": state})
    total = _seconds(ctx, "timeoutSeconds", 10, "Esperar até (s)")
    eid = ctx.execution_id

    def run() -> None:
        page = _page(eid)
        _sliced(ctx, total, lambda ms: page.wait_for_selector(sel, state=state, timeout=ms), "Esperar", sel)

    _worker.call(ctx, run)
    return {"outputs": {"selector": sel, "state": state}, "message": f"“{sel[:80]}” ficou {state}."}


@action("web.close")
def close(ctx: ActionContext) -> dict[str, Any]:
    closed = _worker.call(ctx, lambda: _worker.close_session(ctx.execution_id))
    return {"outputs": {"closed": bool(closed)}, "message": "Navegador fechado." if closed else "Não havia navegador aberto."}
