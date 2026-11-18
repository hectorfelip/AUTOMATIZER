"""Importar este pacote registra as ações embutidas."""

import os

from . import files, flow, input, windows  # noqa: F401

# Ações de teste (travar, cair, poluir stdout...) só existem quando pedidas explicitamente.
if os.environ.get("AUTOMATION_ENGINE_TEST_ACTIONS") == "1":
    from . import testing  # noqa: F401
