"""Validação dos comandos recebidos do Main."""

import json
from dataclasses import dataclass
from typing import Any

COMMANDS = {"ping", "execute_action", "cancel", "shutdown"}


class ProtocolError(Exception):
    pass


@dataclass
class Command:
    type: str
    request_id: str
    payload: dict[str, Any]


def parse_command(raw: bytes) -> Command:
    try:
        obj = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ProtocolError(f"Linha não é JSON válido: {e}") from None
    if not isinstance(obj, dict):
        raise ProtocolError("A mensagem deve ser um objeto JSON.")
    type_ = obj.get("type")
    if not isinstance(type_, str) or type_ not in COMMANDS:
        raise ProtocolError(f"Comando desconhecido: {str(type_)[:50]!r}.")
    request_id = obj.get("requestId", "")
    if not isinstance(request_id, str) or not request_id or len(request_id) > 200:
        raise ProtocolError("requestId ausente ou inválido.")
    payload = obj.get("payload", {})
    if not isinstance(payload, dict):
        raise ProtocolError("payload deve ser um objeto.")
    return Command(type_, request_id, payload)
