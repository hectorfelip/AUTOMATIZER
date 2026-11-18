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
