"""JSON Lines: leitura com limite de tamanho e escrita serializada."""

import json
import threading
from typing import Any, BinaryIO, Optional, Union

MAX_LINE_BYTES = 1024 * 1024  # 1 MiB (docs/PROTOCOL.md)


class Oversize:
    """Marcador: uma linha passou do limite e foi descartada."""


def read_message(stream: BinaryIO) -> Optional[Union[bytes, Oversize]]:
    """Lê uma linha. None = EOF. Linha grande demais é consumida até o `\\n` e devolve Oversize."""
    line = stream.readline(MAX_LINE_BYTES + 1)
    if not line:
        return None
    if len(line) > MAX_LINE_BYTES and not line.endswith(b"\n"):
        while True:  # descarta o resto sem guardar na memória
            rest = stream.readline(MAX_LINE_BYTES + 1)
            if not rest or rest.endswith(b"\n"):
                break
        return Oversize()
    return line


class Writer:
    """Escreve uma mensagem por linha; thread-safe (ações rodam em threads)."""

    def __init__(self, stream: BinaryIO) -> None:
        self._stream = stream
        self._lock = threading.Lock()
        self._event_id = 0

    def send(self, type_: str, request_id: str = "", payload: Optional[dict[str, Any]] = None) -> None:
        with self._lock:
            self._event_id += 1
            msg = {"type": type_, "requestId": request_id, "eventId": self._event_id, "payload": payload or {}}
            # ensure_ascii: a linha é ASCII puro, imune a problemas de codificação do console no Windows
            data = json.dumps(msg, ensure_ascii=True, separators=(",", ":")).encode("ascii") + b"\n"
            self._stream.write(data)
            self._stream.flush()
