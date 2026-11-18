import threading
from typing import Any, Callable, Optional


class ActionError(Exception):
    """Falha esperada de uma ação: `message` vai para o usuário, `details` é técnico."""

    def __init__(self, code: str, message: str, details: Optional[dict[str, Any]] = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class ActionCancelled(Exception):
    """A ação percebeu o cancelamento e parou."""


class ActionContext:
    """O que uma ação enxerga: sua config, cancelamento cooperativo e progresso."""

    def __init__(
        self,
        execution_id: str,
        node_id: str,
        config: dict[str, Any],
        cancel: threading.Event,
        on_progress: Callable[[Optional[float], Optional[str]], None],
    ) -> None:
        self.execution_id = execution_id
        self.node_id = node_id
        self.config = config
        self._cancel = cancel
        self._on_progress = on_progress

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def check_cancelled(self) -> None:
        if self._cancel.is_set():
            raise ActionCancelled()

    def sleep(self, seconds: float) -> None:
        """Dorme até `seconds`, acordando na hora se cancelarem (levanta ActionCancelled)."""
        if self._cancel.wait(seconds):
            raise ActionCancelled()

    def progress(self, percent: Optional[float] = None, message: Optional[str] = None) -> None:
        self._on_progress(percent, message)
