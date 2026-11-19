"""Janelas e aplicativos. `open_app` funciona em qualquer SO; localizar/ativar janela é só Windows (pywinauto/UIA)."""

import os
import shlex
import shutil
import subprocess
import sys
import time
from typing import Any

from ..runtime.context import ActionContext, ActionError
from ..runtime.platform import is_windows
from ..runtime.registry import action
from .paths import text_field


def require_windows(feature: str) -> None:
    if not is_windows():
        raise ActionError("UNSUPPORTED_PLATFORM", f"“{feature}” só funciona no Windows.", {"platform": sys.platform})


def resolve_executable(app: str) -> str:
    expanded = os.path.expandvars(os.path.expanduser(app.strip()))
    if os.path.isabs(expanded):
        if not os.path.isfile(expanded):
            raise ActionError("APP_NOT_FOUND", f"O aplicativo “{expanded}” não existe.", {"application": app})
        return expanded
    found = shutil.which(expanded)
    if not found:
        raise ActionError(
            "APP_NOT_FOUND",
            f"Não encontrei o aplicativo “{app}”. Informe o caminho completo ou o nome de um programa instalado (ex.: notepad.exe).",
            {"application": app},
        )
    return found


def split_args(text: str) -> list[str]:
    if not text.strip():
        return []
    try:
        parts = shlex.split(text, posix=not is_windows())
    except ValueError:
        raise ActionError("INVALID_CONFIG", "Os argumentos têm aspas sem fechar.", {"arguments": text}) from None
    return [p[1:-1] if len(p) >= 2 and p[0] == p[-1] == '"' else p for p in parts]  # shlex não-POSIX mantém as aspas


def _detach_kwargs() -> dict[str, Any]:
    """O aplicativo aberto não pode morrer junto com o motor (reinícios, cancelamento)."""
    if is_windows():
        flags = getattr(subprocess, "DETACHED_PROCESS", 0x8) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200)
        return {"creationflags": flags}
    return {"start_new_session": True}


@action("windows.open_app")
def open_app(ctx: ActionContext) -> dict[str, Any]:
    exe = resolve_executable(text_field(ctx.config, "application", "Aplicativo"))
    args = split_args(text_field(ctx.config, "arguments", "Argumentos", required=False))
    try:
        proc = subprocess.Popen(  # sem shell: o aplicativo e os argumentos nunca são interpretados por um shell
            [exe, *args], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True, **_detach_kwargs()
        )
    except FileNotFoundError:
        raise ActionError("APP_NOT_FOUND", f"Não encontrei “{exe}”.", {"application": exe}) from None
    except OSError as e:
        elevated = getattr(e, "winerror", None) == 740
        msg = f"“{exe}” exige permissão de administrador; o Automation Studio precisa rodar como administrador para abri-lo." if elevated else f"Não consegui abrir “{exe}”: {e.strerror or e}"
        raise ActionError("APP_START_FAILED", msg, {"application": exe, "errno": e.errno}) from None
    return {"outputs": {"pid": proc.pid, "application": exe}, "message": f"Aplicativo iniciado (PID {proc.pid})."}


def dependency_missing(lib: str, err: ImportError) -> ActionError:
    """Erro de dependência que diz POR QUÊ e COMO resolver (qual Python o motor está usando e o import que falhou)."""
    return ActionError(
        "DEPENDENCY_MISSING",
        f"A biblioteca {lib} não pôde ser carregada ({type(err).__name__}: {str(err)[:200]}). "
        f"Instale no Python usado pelo motor ({sys.executable}) com: python -m pip install -r engine/python/requirements-windows.txt",
        {"library": lib, "python": sys.executable, "error": str(err)[:300]},
    )


@action("windows.activate_window")
def activate_window(ctx: ActionContext) -> dict[str, Any]:
    require_windows("Ativar janela")
    title = text_field(ctx.config, "title", "Título da janela")
    timeout = ctx.config.get("timeoutSeconds", 10)
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 <= timeout <= 3600:
        raise ActionError("INVALID_CONFIG", "“Esperar até (s)” deve ser um número entre 0 e 3600.", {"timeoutSeconds": timeout})
    try:
        from pywinauto import Desktop  # type: ignore[import-not-found]
    except ImportError as e:
        raise dependency_missing("pywinauto", e) from None

    needle = title.lower()
    deadline = time.monotonic() + float(timeout)
    while True:
        ctx.check_cancelled()
        match = None
        for w in Desktop(backend="uia").windows():  # só janelas visíveis de nível superior
            try:
                text = w.window_text()
            except Exception:  # noqa: BLE001 - janela que some durante a enumeração
                continue
            if text and needle in text.lower():
                match = (w, text)
                break
        if match or time.monotonic() >= deadline:
            break
        ctx.sleep(0.25)
    if not match:
        raise ActionError("WINDOW_NOT_FOUND", f"Não encontrei uma janela com “{title}” no título (esperei {float(timeout):g}s).", {"title": title})

    window, text = match
    try:
        if window.is_minimized():
            window.restore()
        window.set_focus()
        handle, pid = window.handle, window.process_id()
    except Exception as e:  # noqa: BLE001
        raise ActionError(
            "WINDOW_ACTIVATION_FAILED",
            f"Encontrei a janela “{text}”, mas não consegui trazê-la para frente. Se o aplicativo roda como administrador, o Automation Studio também precisa rodar como administrador.",
            {"title": text, "error": str(e)},
        ) from None
    return {"outputs": {"title": text, "handle": handle, "pid": pid}, "message": f"Janela “{text}” ativada."}
