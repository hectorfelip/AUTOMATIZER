import threading
import time

import pytest

import automation_engine.actions  # noqa: F401
from automation_engine.actions import uia
from automation_engine.actions.uia import Element, match
from automation_engine.runtime.context import ActionCancelled, ActionError
from helpers import Ran, run


def el(name, ctype="Button", aid="", box=(100, 100, 200, 140)):
    return Element(name, ctype, aid, *box)


class FakeBackend:
    def __init__(self, windows, frames):
        self.windows = windows
        self.frames = list(frames)  # lista de listas de Element, uma por consulta
        self.calls = 0

    def window_exists(self, title):
        return any(title.lower() in w.lower() for w in self.windows)

    def elements(self, title, ctype):
        self.calls += 1
        return self.frames[min(self.calls - 1, len(self.frames) - 1)]


class FakePG:
    FailSafeException = type("FailSafeException", (Exception,), {})

    def __init__(self, screen=(1920, 1080), failsafe=False):
        self.screen, self.clicks, self.failsafe = screen, [], failsafe

    def size(self):
        return self.screen

    def click(self, **kw):
        if self.failsafe:
            raise self.FailSafeException()
        self.clicks.append(kw)


@pytest.fixture
def pg(monkeypatch):
    f = FakePG()
    monkeypatch.setattr(uia, "_pyautogui", lambda: f)
    yield f
    uia.set_backend(None)


def code(fn):
    with pytest.raises(ActionError) as e:
        fn()
    return e.value


class TestMatch:
    ELS = [el("Salvar como...", box=(300, 400, 400, 440)), el("Salvar", box=(100, 400, 200, 440)), el("Cancelar", box=(220, 400, 290, 440)), el("Nome", "Edit", "txtNome", (100, 50, 300, 80)), el("Salvar", "MenuItem", box=(10, 5, 60, 25))]

    def test_nome_contem_sem_caixa_nem_acento_e_ordem_de_tela(self):
        got = match(self.ELS, "SALVAR", "", "")
        assert [(e.name, e.control_type) for e in got] == [("Salvar", "MenuItem"), ("Salvar", "Button"), ("Salvar como...", "Button")]
        assert [e.name for e in match(self.ELS, "cancelár", "", "")] == ["Cancelar"]

    def test_tipo_e_automation_id(self):
        assert [e.name for e in match(self.ELS, "salvar", "", "button")] == ["Salvar", "Salvar como..."]
        assert [e.name for e in match(self.ELS, "", "txtNome", "")] == ["Nome"]
        assert match(self.ELS, "", "TXTNOME", "") == []  # id é exato
        assert match(self.ELS, "inexistente", "", "") == []


class TestAction:
    def test_clica_no_centro_do_elemento_e_devolve_o_que_achou(self, pg):
        uia.set_backend(FakeBackend(["Bloco de Notas"], [[el("Salvar", box=(100, 400, 200, 440))]]))
        out = run("windows.click_element", {"windowTitle": "bloco", "elementName": "salvar"})
        assert pg.clicks == [{"x": 150, "y": 420, "button": "left", "clicks": 1, "interval": 0.1}]
        assert out["outputs"] == {"x": 150, "y": 420, "name": "Salvar", "controlType": "Button"}

    def test_botoes_direito_e_duplo(self, pg):
        uia.set_backend(FakeBackend(["App"], [[el("Item")]]))
        run("windows.click_element", {"windowTitle": "App", "elementName": "item", "button": "right"})
        run("windows.click_element", {"windowTitle": "App", "elementName": "item", "button": "double"})
        assert (pg.clicks[0]["button"], pg.clicks[0]["clicks"]) == ("right", 1)
        assert (pg.clicks[1]["button"], pg.clicks[1]["clicks"]) == ("left", 2)

    def test_posicao_escolhe_entre_varios(self, pg):
        els = [el("Salvar", box=(0, 0, 10, 10)), el("Salvar", box=(0, 100, 10, 110)), el("Salvar", box=(0, 200, 10, 210))]
        uia.set_backend(FakeBackend(["App"], [els]))
        run("windows.click_element", {"windowTitle": "App", "elementName": "salvar", "index": 3})
        assert pg.clicks[0]["y"] == 205
        e = code(lambda: run("windows.click_element", {"windowTitle": "App", "elementName": "salvar", "index": 4, "timeoutSeconds": 0}))
        assert e.code == "ELEMENT_NOT_FOUND" and "posição 4" in e.message

    def test_espera_o_elemento_aparecer(self, pg):
        b = FakeBackend(["App"], [[], [], [el("Entrar")]])
        uia.set_backend(b)
        t0 = time.monotonic()
        run("windows.click_element", {"windowTitle": "App", "elementName": "entrar", "timeoutSeconds": 5})
        assert b.calls == 3 and 0.8 < time.monotonic() - t0 < 4

    def test_janela_inexistente_x_elemento_inexistente_sao_erros_diferentes(self, pg):
        uia.set_backend(FakeBackend([], [[]]))
        e = code(lambda: run("windows.click_element", {"windowTitle": "Fantasma", "elementName": "x", "timeoutSeconds": 0}))
        assert e.code == "WINDOW_NOT_FOUND" and "Ativar janela" in e.message
        uia.set_backend(FakeBackend(["App"], [[el("Outro")]]))
        e = code(lambda: run("windows.click_element", {"windowTitle": "App", "elementName": "Salvar", "controlType": "Button", "timeoutSeconds": 0}))
        assert e.code == "ELEMENT_NOT_FOUND" and "Salvar" in e.message and "Button" in e.message
        assert pg.clicks == []

    def test_cancelar_a_espera_responde_rapido(self, pg):
        uia.set_backend(FakeBackend(["App"], [[]]))
        ran = Ran()
        threading.Timer(0.4, ran.cancel.set).start()
        t0 = time.monotonic()
        with pytest.raises(ActionCancelled):
            run("windows.click_element", {"windowTitle": "App", "elementName": "x", "timeoutSeconds": 60}, ran)
        assert time.monotonic() - t0 < 2

    def test_failsafe_e_fora_da_tela(self, monkeypatch):
        f = FakePG(failsafe=True)
        monkeypatch.setattr(uia, "_pyautogui", lambda: f)
        uia.set_backend(FakeBackend(["App"], [[el("X")]]))
        assert code(lambda: run("windows.click_element", {"windowTitle": "App", "elementName": "x"})).code == "FAILSAFE_TRIGGERED"
        g = FakePG(screen=(100, 100))
        monkeypatch.setattr(uia, "_pyautogui", lambda: g)
        e = code(lambda: run("windows.click_element", {"windowTitle": "App", "elementName": "x"}))
        assert e.code == "COORDINATES_OUT_OF_SCREEN" and g.clicks == []
        uia.set_backend(None)

    @pytest.mark.parametrize(
        "cfg",
        [
            {},
            {"windowTitle": "App"},
            {"windowTitle": "", "elementName": "x"},
            {"windowTitle": "App", "elementName": "x", "controlType": "Foo"},
            {"windowTitle": "App", "elementName": "x", "index": 0},
            {"windowTitle": "App", "elementName": "x", "index": 1.5},
            {"windowTitle": "App", "elementName": "x", "button": "meio"},
            {"windowTitle": "App", "elementName": "x", "timeoutSeconds": -1},
            {"windowTitle": "x" * 301, "elementName": "x"},
        ],
    )
    def test_config_invalida(self, cfg, pg):
        uia.set_backend(FakeBackend(["App"], [[el("x")]]))
        assert code(lambda: run("windows.click_element", cfg)).code == "INVALID_CONFIG"

    def test_fora_do_windows_diz_que_so_existe_no_windows(self):
        import sys

        if sys.platform == "win32":
            pytest.skip("só Linux/macOS")
        e = code(lambda: run("windows.click_element", {"windowTitle": "App", "elementName": "x"}))
        assert e.code == "UNSUPPORTED_PLATFORM"
