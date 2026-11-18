import threading
from typing import Any

import automation_engine.actions  # noqa: F401  (registra as ações)
from automation_engine.runtime import registry
from automation_engine.runtime.context import ActionContext


class Ran:
    def __init__(self) -> None:
        self.progress: list[tuple[Any, Any]] = []
        self.cancel = threading.Event()


def run(action: str, config: dict, ran: Ran | None = None) -> dict:
    """Executa uma ação direto (sem processo), como o motor faria."""
    ran = ran or Ran()
    ctx = ActionContext("e", "n", config, ran.cancel, lambda p, m: ran.progress.append((p, m)))
    fn = registry.get_action(action)
    assert fn, f"ação {action} não registrada"
    return fn(ctx) or {}
