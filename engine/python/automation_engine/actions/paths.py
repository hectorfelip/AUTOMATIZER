"""Validação de caminhos e tradução de erros do sistema para erros de ação compreensíveis."""

import os
import re
from typing import Any, Callable

from ..runtime.context import ActionError
from ..runtime.platform import is_windows

WILDCARDS = "*?"


def text_field(config: dict[str, Any], key: str, label: str, required: bool = True) -> str:
    value = config.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise ActionError("INVALID_CONFIG", f"O campo “{label}” é obrigatório.", {"field": key})
        return ""
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ActionError("INVALID_CONFIG", f"O campo “{label}” deve ser um texto.", {"field": key})
    return str(value)


def resolve_path(value: str, label: str = "Caminho") -> str:
    """Caminho absoluto e normalizado. Aceita `~` e variáveis de ambiente (%USERPROFILE%, $HOME)."""
    raw = value.strip()
    if "\x00" in raw:
        raise ActionError("INVALID_CONFIG", f"“{label}” contém caracteres inválidos.")
    expanded = os.path.expandvars(os.path.expanduser(raw))
    if not os.path.isabs(expanded):
        raise ActionError(
            "INVALID_CONFIG",
            f"“{label}” deve ser um caminho completo (ex.: C:\\Pasta\\arquivo.txt), mas recebeu “{raw}”.",
            {"value": raw},
        )
    return os.path.normpath(expanded)


def has_wildcard(name: str) -> bool:
    return any(c in name for c in WILDCARDS)


def compile_pattern(pattern: str) -> Callable[[str], bool]:
    """`*` e `?` como curingas; todo o resto é literal (colchetes são comuns em nomes de arquivo)."""
    regex = "".join(".*" if c == "*" else "." if c == "?" else re.escape(c) for c in pattern)
    rx = re.compile(f"^{regex}$", re.IGNORECASE if is_windows() else 0)
    return lambda name: rx.match(name) is not None


_INVALID_WIN = set('<>:"|?*')
_RESERVED_WIN = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def validate_file_name(name: str) -> str:
    """Valida um nome (sem pasta) para renomear. Regras do Windows só se aplicam no Windows."""
    n = name  # não aplicamos strip: renomear para um nome diferente do pedido, em silêncio, seria pior que recusar
    if not n.strip() or n in (".", ".."):
        raise ActionError("INVALID_CONFIG", "O novo nome é inválido.")
    if "/" in n or "\\" in n or "\x00" in n:
        raise ActionError("INVALID_CONFIG", "O novo nome não pode conter “/” nem “\\”; informe só o nome.", {"value": name})
    if is_windows():
        bad = sorted(set(n) & _INVALID_WIN)
        if bad:
            raise ActionError("INVALID_CONFIG", f"O novo nome não pode conter: {' '.join(bad)}", {"value": name})
        if n.endswith((".", " ")):
            raise ActionError("INVALID_CONFIG", "No Windows o nome não pode terminar com ponto ou espaço.", {"value": name})
        if n.split(".")[0].upper() in _RESERVED_WIN:
            raise ActionError("INVALID_CONFIG", f"“{n}” é um nome reservado do Windows.", {"value": name})
    return n


def os_error(e: OSError, path: str) -> ActionError:
    """Traduz erros do sistema operacional em erros de ação com mensagem útil."""
    if isinstance(e, FileNotFoundError):
        return ActionError("PATH_NOT_FOUND", f"Não encontrei “{path}”.", {"path": path})
    if isinstance(e, PermissionError):
        return ActionError(
            "PERMISSION_DENIED",
            f"Sem permissão para acessar “{path}”. Verifique se o arquivo está em uso ou se a pasta exige administrador.",
            {"path": path},
        )
    if isinstance(e, FileExistsError):
        return ActionError("DESTINATION_EXISTS", f"“{path}” já existe.", {"path": path})
    if isinstance(e, NotADirectoryError):
        return ActionError("NOT_A_DIRECTORY", f"“{path}” não é uma pasta.", {"path": path})
    if isinstance(e, IsADirectoryError):
        return ActionError("IS_A_DIRECTORY", f"“{path}” é uma pasta, e esta ação trabalha com arquivos.", {"path": path})
    return ActionError("IO_ERROR", f"Erro ao acessar “{path}”: {e.strerror or e}", {"path": path, "errno": e.errno})
