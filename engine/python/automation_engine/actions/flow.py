from typing import Any

from ..runtime.context import ActionContext, ActionError
from ..runtime.registry import action

MAX_WAIT_SECONDS = 86_400


@action("flow.wait")
def wait(ctx: ActionContext) -> dict[str, Any]:
    seconds = ctx.config.get("seconds")
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not 0 <= seconds <= MAX_WAIT_SECONDS:
        raise ActionError("INVALID_CONFIG", "“Segundos” deve ser um número entre 0 e 86400.", {"seconds": seconds})
    remaining = float(seconds)
    total = remaining
    while remaining > 0:
        step = min(remaining, 1.0)  # acorda a cada 1 s para reportar progresso
        ctx.sleep(step)
        remaining -= step
        ctx.progress(100.0 * (total - remaining) / total, f"Aguardando… {total - remaining:.0f}/{total:.0f}s")
    return {"outputs": {"waitedSeconds": total}, "message": f"Aguardou {total:g}s."}
