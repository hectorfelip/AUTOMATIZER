import json
import sys
import threading
import time
import traceback
from importlib import metadata
from typing import Any, BinaryIO, Optional

from .. import PROTOCOL_VERSION, __version__
from ..protocol.framing import Oversize, Writer, read_message
from ..protocol.messages import Command, ProtocolError, parse_command
from . import registry
from .context import ActionCancelled, ActionContext, ActionError

OPTIONAL_MODULES = ("pywinauto", "pyautogui")  # dependências de automação Windows (Fase 4)


def _module_versions() -> dict[str, dict[str, Optional[str]]]:
    out: dict[str, dict[str, Optional[str]]] = {}
    for name in OPTIONAL_MODULES:
        try:
            out[name] = {"version": metadata.version(name)}
        except metadata.PackageNotFoundError:
            out[name] = {"version": None}
    return out


class Engine:
    def __init__(self, stdin: BinaryIO, stdout: BinaryIO) -> None:
        self._stdin = stdin
        self._writer = Writer(stdout)
        self._started = time.monotonic()
        self._tokens: dict[str, threading.Event] = {}  # executionId -> cancelamento da ação em curso
        self._lock = threading.Lock()

    # ---- loop principal ----
    def run(self) -> int:
        self._writer.send(
            "ready",
            payload={
                "engineVersion": __version__,
                "protocolVersion": PROTOCOL_VERSION,
                "python": sys.version.split()[0],
                "platform": sys.platform,
                "actions": registry.list_actions(),
                "optionalModules": _module_versions(),
            },
        )
        while True:
            raw = read_message(self._stdin)
            if raw is None:  # EOF: o Main morreu ou fechou o pipe
                self._cancel_all()
                return 0
            if isinstance(raw, Oversize):
                self._writer.send("protocol_error", payload={"message": "Mensagem maior que 1 MiB descartada."})
                continue
            if not raw.strip():
                continue
            try:
                cmd = parse_command(raw)
            except ProtocolError as e:
                self._writer.send("protocol_error", payload={"message": str(e)})
                continue
            if cmd.type == "shutdown":
                self._cancel_all()
                self._writer.send("bye", cmd.request_id)
                return 0
            self._dispatch(cmd)

    def _dispatch(self, cmd: Command) -> None:
        if cmd.type == "ping":
            with self._lock:
                active = len(self._tokens)
            self._writer.send(
                "pong", cmd.request_id, {"uptimeMs": int((time.monotonic() - self._started) * 1000), "activeExecutions": active}
            )
        elif cmd.type == "cancel":
            execution_id = cmd.payload.get("executionId")
            with self._lock:
                token = self._tokens.get(execution_id) if isinstance(execution_id, str) else None
            if token:
                token.set()
            self._writer.send("cancel_ack", cmd.request_id, {"executionId": execution_id, "found": token is not None})
        elif cmd.type == "execute_action":
            self._start_action(cmd)

    # ---- ações ----
    def _start_action(self, cmd: Command) -> None:
        p = cmd.payload
        execution_id, node_id, name, config = p.get("executionId"), p.get("nodeId"), p.get("action"), p.get("config", {})
        if not (isinstance(execution_id, str) and isinstance(node_id, str) and isinstance(name, str) and isinstance(config, dict)):
            self._writer.send("protocol_error", cmd.request_id, {"message": "execute_action: executionId, nodeId, action e config são obrigatórios."})
            return
        ids = {"executionId": execution_id, "nodeId": node_id}
        token = threading.Event()
        with self._lock:
            if execution_id in self._tokens:  # um fluxo executa uma ação por vez
                busy = True
            else:
                busy = False
                self._tokens[execution_id] = token
        if busy:
            err = {"code": "BUSY", "message": "Já há uma ação em andamento nesta execução.", "details": {}}
            self._writer.send("action_failed", cmd.request_id, {**ids, "error": err})
            return
        threading.Thread(
            target=self._run_action, args=(cmd.request_id, ids, name, config, token), daemon=True, name=f"action-{node_id}"
        ).start()

    def _release(self, execution_id: str, token: threading.Event) -> None:
        """Libera a execução, mas só se o token ainda for o desta ação (nunca o da ação seguinte)."""
        with self._lock:
            if self._tokens.get(execution_id) is token:
                del self._tokens[execution_id]

    def _run_action(self, request_id: str, ids: dict[str, str], name: str, config: dict[str, Any], token: threading.Event) -> None:
        send = self._writer.send

        def progress(percent: Optional[float], message: Optional[str]) -> None:
            payload: dict[str, Any] = dict(ids)
            if percent is not None:
                payload["percent"] = round(float(percent), 1)
            if message:
                payload["message"] = message
            send("action_progress", request_id, payload)

        def finish(type_: str, payload: dict[str, Any]) -> None:
            # A execução é liberada ANTES de avisar o fim: o cliente (interpretador) manda o próximo nó
            # da mesma execução no mesmo instante em que recebe esta mensagem.
            self._release(ids["executionId"], token)
            send(type_, request_id, payload)

        def fail(code: str, message: str, details: Optional[dict[str, Any]] = None) -> None:
            finish("action_failed", {**ids, "error": {"code": code, "message": message, "details": details or {}}})

        try:
            send("action_started", request_id, ids)
            fn = registry.get_action(name)
            if fn is None:
                fail("ACTION_NOT_IMPLEMENTED", f"A ação “{name}” não está disponível neste motor.", {"action": name})
                return
            result = fn(ActionContext(ids["executionId"], ids["nodeId"], config, token, progress)) or {}
            payload = {**ids, "status": "success", "outputs": result.get("outputs", {})}
            for key in ("next", "message"):
                if result.get(key) is not None:
                    payload[key] = result[key]
            try:
                json.dumps(payload)
            except (TypeError, ValueError):
                fail("OUTPUT_NOT_SERIALIZABLE", "A ação devolveu um resultado que não pode ser enviado.")
                return
            finish("action_completed", payload)
        except ActionCancelled:
            finish("action_cancelled", ids)
        except ActionError as e:
            fail(e.code, e.message, e.details)
        except Exception as e:  # noqa: BLE001 - qualquer bug de ação vira erro, nunca derruba o motor
            traceback.print_exc(file=sys.stderr)
            fail("INTERNAL_ERROR", "Erro interno ao executar a ação.", {"type": type(e).__name__, "trace": traceback.format_exc()[-4000:]})
        finally:
            self._release(ids["executionId"], token)  # rede de segurança (ex.: falha ao enviar); idempotente

    def _cancel_all(self) -> None:
        with self._lock:
            for token in self._tokens.values():
                token.set()
