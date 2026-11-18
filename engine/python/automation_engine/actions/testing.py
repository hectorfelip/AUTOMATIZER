"""Ações só para testes de integração (AUTOMATION_ENGINE_TEST_ACTIONS=1). Nunca em produção."""

import os
import sys
import time
from typing import Any

from ..runtime.context import ActionContext, ActionError
from ..runtime.registry import action


@action("test.fail")
def fail(ctx: ActionContext) -> dict[str, Any]:
    raise ActionError("TEST_FAILURE", "Falha de teste.", {"nodeId": ctx.node_id})


@action("test.boom")
def boom(ctx: ActionContext) -> dict[str, Any]:
    raise RuntimeError("segredo interno /caminho/privado")  # vira INTERNAL_ERROR genérico


@action("test.noise")
def noise(ctx: ActionContext) -> dict[str, Any]:
    print("RUIDO NO STDOUT {nao json")  # ação mal-comportada: não pode quebrar o protocolo
    print("ruído no stderr", file=sys.stderr)
    return {"outputs": {"ok": True}}


@action("test.hang")
def hang(ctx: ActionContext) -> dict[str, Any]:
    time.sleep(3600)  # ignora cancelamento de propósito
    return {}


@action("test.crash")
def crash(ctx: ActionContext) -> dict[str, Any]:
    os._exit(7)


@action("test.big")
def big(ctx: ActionContext) -> dict[str, Any]:
    return {"outputs": {"blob": "x" * int(ctx.config.get("size", 10))}}


@action("test.unserializable")
def unserializable(ctx: ActionContext) -> dict[str, Any]:
    return {"outputs": {"bad": object()}}
