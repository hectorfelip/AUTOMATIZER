import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


class EngineProc:
    """Roda o motor de verdade como subprocesso e conversa por JSON Lines."""

    def __init__(self) -> None:
        env = {**os.environ, "AUTOMATION_ENGINE_TEST_ACTIONS": "1", "PYTHONPATH": str(ROOT)}
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "automation_engine"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, cwd=ROOT, env=env,
        )
        self.raw_stdout: list[bytes] = []
        self.stderr_lines: list[str] = []
        self.messages: "queue.Queue[dict]" = queue.Queue()
        threading.Thread(target=self._pump_stdout, daemon=True).start()
        threading.Thread(target=self._pump_stderr, daemon=True).start()
        self.ready = self.recv("ready")

    def _pump_stdout(self) -> None:
        assert self.proc.stdout
        for line in self.proc.stdout:
            self.raw_stdout.append(line)
            self.messages.put(json.loads(line))  # toda linha de stdout TEM que ser JSON

    def _pump_stderr(self) -> None:
        assert self.proc.stderr
        for line in self.proc.stderr:
            self.stderr_lines.append(line.decode("utf-8", "replace"))

    def send(self, type_: str, request_id: str = "r1", payload: dict | None = None) -> None:
        self.send_raw(json.dumps({"type": type_, "requestId": request_id, "payload": payload or {}}).encode() + b"\n")

    def send_raw(self, data: bytes) -> None:
        assert self.proc.stdin
        self.proc.stdin.write(data)
        self.proc.stdin.flush()

    def recv(self, type_: str | None = None, timeout: float = 5.0) -> dict:
        end = time.monotonic() + timeout
        while True:
            left = end - time.monotonic()
            if left <= 0:
                raise TimeoutError(f"nenhuma mensagem{' ' + type_ if type_ else ''} em {timeout}s")
            msg = self.messages.get(timeout=left)
            if type_ is None or msg["type"] == type_:
                return msg

    def collect_until(self, terminal: set[str], timeout: float = 5.0) -> list[dict]:
        out = []
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            msg = self.recv(timeout=max(0.01, end - time.monotonic()))
            out.append(msg)
            if msg["type"] in terminal:
                return out
        raise TimeoutError(f"sem terminal {terminal}; recebido: {[m['type'] for m in out]}")

    def execute(self, action: str, config: dict | None = None, execution_id: str = "e1", request_id: str = "x1") -> None:
        self.send("execute_action", request_id, {"executionId": execution_id, "nodeId": "n1", "action": action, "config": config or {}})

    def wait_exit(self, timeout: float = 5.0) -> int:
        return self.proc.wait(timeout)

    def close(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()
        self.proc.wait()


@pytest.fixture
def engine():
    e = EngineProc()
    yield e
    e.close()
