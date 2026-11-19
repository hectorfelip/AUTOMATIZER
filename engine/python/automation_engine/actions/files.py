"""Ações de arquivos e pastas. Trabalham só com arquivos (nunca apagam nada além de sobrescrever quando pedido)."""

import os
import shutil
from datetime import datetime
from typing import Any, Optional

from ..runtime.context import ActionContext, ActionError
from ..runtime.registry import action
from .paths import compile_pattern, has_wildcard, os_error, resolve_path, text_field, validate_file_name

MAX_LISTED = 2000  # a mensagem do protocolo tem limite de 1 MiB
MAX_ITEMS = 500


def _is_true(value: Any) -> bool:
    return value is True


def _require_dir(path: str, label: str) -> None:
    if not os.path.exists(path):
        raise ActionError("PATH_NOT_FOUND", f"A pasta “{path}” não existe.", {"path": path, "field": label})
    if not os.path.isdir(path):
        raise ActionError("NOT_A_DIRECTORY", f"“{path}” não é uma pasta.", {"path": path})


@action("files.list")
def list_files(ctx: ActionContext) -> dict[str, Any]:
    folder = resolve_path(text_field(ctx.config, "path", "Pasta"), "Pasta")
    pattern = text_field(ctx.config, "pattern", "Filtro", required=False) or "*"
    recursive = _is_true(ctx.config.get("recursive"))
    _require_dir(folder, "path")
    matches = compile_pattern(pattern)

    entries: list[dict[str, Any]] = []
    total = 0
    skipped = 0

    def on_error(_e: OSError) -> None:  # subpasta sem permissão: pula e conta
        nonlocal skipped
        skipped += 1

    try:
        walker = os.walk(folder, onerror=on_error) if recursive else [(folder, [], os.listdir(folder))]
        for root, _dirs, names in walker:
            ctx.check_cancelled()
            for name in sorted(names):
                full = os.path.join(root, name)
                if not os.path.isfile(full) or not matches(name):
                    continue
                total += 1
                if len(entries) < MAX_LISTED:
                    try:
                        st = os.stat(full)
                        size, modified = st.st_size, datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds")
                    except OSError:
                        size, modified = None, None
                    stem, ext = os.path.splitext(name)
                    entries.append({"name": name, "stem": stem, "extension": ext.lstrip(".").lower(), "path": full, "folder": root, "size": size, "modifiedAt": modified})
    except OSError as e:
        raise os_error(e, folder) from None

    note = f" ({skipped} subpasta(s) sem permissão foram ignoradas)" if skipped else ""
    if total > len(entries):  # nunca deixar um resultado incompleto parecer completo
        note += f" ATENÇÃO: a lista mostra só os primeiros {len(entries)}; os outros {total - len(entries)} ficaram de fora. Rode de novo para processá-los."
    return {
        "outputs": {"folder": folder, "pattern": pattern, "count": total, "files": entries, "truncated": total > len(entries), "skipped": skipped},
        "message": f"{total} arquivo(s) em “{folder}”{note}.",
    }


@action("files.exists")
def exists(ctx: ActionContext) -> dict[str, Any]:
    path = resolve_path(text_field(ctx.config, "path", "Caminho"), "Caminho")
    kind: Optional[str] = "file" if os.path.isfile(path) else "folder" if os.path.isdir(path) else None
    found = kind is not None
    return {
        "outputs": {"path": path, "exists": found, "kind": kind},
        "next": "true" if found else "false",
        "message": f"“{path}” {'existe' if found else 'não existe'}.",
    }


@action("files.create_folder")
def create_folder(ctx: ActionContext) -> dict[str, Any]:
    path = resolve_path(text_field(ctx.config, "path", "Pasta"), "Pasta")
    already = os.path.isdir(path)
    try:
        os.makedirs(path, exist_ok=True)
    except FileExistsError:
        raise ActionError("DESTINATION_EXISTS", f"Já existe um arquivo chamado “{path}”; não dá para criar uma pasta com esse nome.", {"path": path}) from None
    except OSError as e:
        raise os_error(e, path) from None
    return {"outputs": {"path": path, "created": not already}, "message": f"Pasta “{path}” {'já existia' if already else 'criada'}."}


def _transfer(ctx: ActionContext, move: bool) -> dict[str, Any]:
    src = resolve_path(text_field(ctx.config, "source", "Origem"), "Origem")
    dst_raw = text_field(ctx.config, "destination", "Destino")
    dst = resolve_path(dst_raw, "Destino")
    overwrite = _is_true(ctx.config.get("overwrite"))
    folder, name = os.path.split(src)
    verb = "Movido" if move else "Copiado"

    # ---- 1. quais arquivos e para onde ----
    if has_wildcard(folder):
        raise ActionError("INVALID_CONFIG", "O curinga (* ou ?) só pode aparecer no nome do arquivo, não nas pastas.", {"source": src})
    if has_wildcard(name):
        _require_dir(folder, "source")
        matches = compile_pattern(name)
        try:
            sources = sorted(os.path.join(folder, n) for n in os.listdir(folder) if matches(n) and os.path.isfile(os.path.join(folder, n)))
        except OSError as e:
            raise os_error(e, folder) from None
        if os.path.exists(dst) and not os.path.isdir(dst):
            raise ActionError("NOT_A_DIRECTORY", f"Com curinga na origem, o destino deve ser uma pasta, e “{dst}” é um arquivo.", {"destination": dst})
        pairs = [(s, os.path.join(dst, os.path.basename(s))) for s in sources]
    else:
        if not os.path.exists(src):
            raise ActionError("PATH_NOT_FOUND", f"Não encontrei o arquivo de origem “{src}”.", {"path": src})
        if os.path.isdir(src):
            raise ActionError("IS_A_DIRECTORY", f"“{src}” é uma pasta; esta ação trabalha com arquivos.", {"path": src})
        into_folder = os.path.isdir(dst) or dst_raw.strip().endswith(("/", "\\"))
        pairs = [(src, os.path.join(dst, os.path.basename(src)) if into_folder else dst)]

    if not pairs:
        return {"outputs": {"count": 0, "items": [], "overwritten": 0}, "message": f"Nenhum arquivo corresponde a “{name}” em “{folder}”; nada foi feito."}

    # ---- 2. checa TODOS os conflitos antes de tocar em qualquer coisa ----
    conflicts: list[str] = []
    for s, t in pairs:
        if os.path.exists(t):
            if os.path.samefile(s, t):
                raise ActionError("SAME_PATH", f"Origem e destino são o mesmo arquivo: “{s}”.", {"path": s})
            if os.path.isdir(t):
                raise ActionError("IS_A_DIRECTORY", f"O destino “{t}” é uma pasta.", {"path": t})
            if not overwrite:
                conflicts.append(t)
    if conflicts:
        raise ActionError(
            "DESTINATION_EXISTS",
            f"{len(conflicts)} arquivo(s) de destino já existem (ex.: “{conflicts[0]}”). Nada foi alterado. Ative “Sobrescrever se existir” para substituí-los.",
            {"conflicts": conflicts[:10], "total": len(conflicts)},
        )

    # ---- 3. executa ----
    done: list[dict[str, str]] = []
    replaced = 0
    try:
        for i, (s, t) in enumerate(pairs, 1):
            ctx.check_cancelled()
            os.makedirs(os.path.dirname(t), exist_ok=True)
            if os.path.exists(t):
                replaced += 1
            (shutil.move if move else shutil.copy2)(s, t)
            done.append({"source": s, "destination": t})
            if len(pairs) > 1:
                ctx.progress(100.0 * i / len(pairs), f"{verb} {i}/{len(pairs)}")
    except OSError as e:
        err = os_error(e, getattr(e, "filename", None) or src)
        err.details["completed"] = len(done)
        err.message += f" ({len(done)} de {len(pairs)} arquivo(s) já tinham sido processados.)" if done else ""
        raise err from None

    where = os.path.dirname(pairs[0][1]) if len(pairs) > 1 else pairs[0][1]
    extra = f" ({replaced} substituído(s))" if replaced else ""
    return {
        "outputs": {"count": len(done), "items": done[:MAX_ITEMS], "truncated": len(done) > MAX_ITEMS, "overwritten": replaced},
        "message": f"{verb}(s) {len(done)} arquivo(s) para “{where}”{extra}." if len(done) > 1 else f"{verb} para “{where}”{extra}.",
    }


@action("files.copy")
def copy(ctx: ActionContext) -> dict[str, Any]:
    return _transfer(ctx, move=False)


@action("files.move")
def move(ctx: ActionContext) -> dict[str, Any]:
    return _transfer(ctx, move=True)


@action("files.rename")
def rename(ctx: ActionContext) -> dict[str, Any]:
    path = resolve_path(text_field(ctx.config, "path", "Caminho atual"), "Caminho atual")
    new_name = validate_file_name(text_field(ctx.config, "newName", "Novo nome"))
    if not os.path.exists(path):
        raise ActionError("PATH_NOT_FOUND", f"Não encontrei “{path}”.", {"path": path})
    target = os.path.join(os.path.dirname(path), new_name)
    if os.path.basename(path) == new_name:
        raise ActionError("SAME_PATH", "O novo nome é igual ao atual.", {"path": path})
    if os.path.exists(target):
        raise ActionError("DESTINATION_EXISTS", f"Já existe “{target}”. Escolha outro nome.", {"path": target})
    try:
        os.rename(path, target)
    except OSError as e:
        raise os_error(e, path) from None
    return {"outputs": {"oldPath": path, "path": target}, "message": f"Renomeado para “{new_name}”."}
