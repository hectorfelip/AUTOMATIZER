"""Registro de ações: lista explícita do que o motor pode executar (sem shell arbitrário)."""

from typing import Any, Callable, Optional

from .context import ActionContext

ActionFn = Callable[[ActionContext], Optional[dict[str, Any]]]
_ACTIONS: dict[str, ActionFn] = {}


def action(name: str) -> Callable[[ActionFn], ActionFn]:
    def register(fn: ActionFn) -> ActionFn:
        if name in _ACTIONS:
            raise ValueError(f"Ação já registrada: {name}")
        _ACTIONS[name] = fn
        return fn

    return register


def get_action(name: str) -> Optional[ActionFn]:
    return _ACTIONS.get(name)


def list_actions() -> list[str]:
    return sorted(_ACTIONS)


# Limpeza de recursos de uma execução (ex.: navegador aberto). O motor chama ao receber `cancel` — que o app envia
# também quando a execução termina — e ao encerrar. Os ganchos nunca podem lançar nem bloquear.
_EXECUTION_END: list[Callable[[str], None]] = []
_SHUTDOWN: list[Callable[[], None]] = []


def on_execution_end(fn: Callable[[str], None]) -> None:
    _EXECUTION_END.append(fn)


def on_shutdown(fn: Callable[[], None]) -> None:
    _SHUTDOWN.append(fn)


def run_execution_end(execution_id: str) -> None:
    for fn in _EXECUTION_END:
        try:
            fn(execution_id)
        except Exception:  # noqa: BLE001 - limpeza nunca derruba o motor
            pass


def run_shutdown() -> None:
    for fn in _SHUTDOWN:
        try:
            fn()
        except Exception:  # noqa: BLE001
            pass
