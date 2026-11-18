"""Ações de janela/teclado/mouse. A LÓGICA roda de verdade aqui (parsers, validações, mapeamento de erros);
as chamadas ao pywinauto/pyautogui usam dublês. O efeito real na tela só se verifica no Windows."""

import os
import signal
import sys
import time
import types

import pytest

from automation_engine.actions import input as inp
from automation_engine.actions import windows as win
from automation_engine.runtime.context import ActionCancelled, ActionError
from helpers import Ran, run


def err(action: str, config: dict, ran: Ran | None = None) -> ActionError:
    with pytest.raises(ActionError) as e:
        run(action, config, ran)
    return e.value


@pytest.fixture
def on_windows(monkeypatch):
    monkeypatch.setattr(win, "is_windows", lambda: True)


# ---------- dublês ----------
class FakeWindow:
    def __init__(self, title, minimized=False, focus_error=None):
        self.title, self.minimized, self.focus_error, self.calls = title, minimized, focus_error, []
        self.handle, self._pid = 4242, 99

    def window_text(self):
        return self.title

    def is_minimized(self):
        return self.minimized

    def restore(self):
        self.minimized = False
        self.calls.append("restore")

    def set_focus(self):
        if self.focus_error:
            raise self.focus_error
        self.calls.append("focus")

    def process_id(self):
        return self._pid


@pytest.fixture
def desktop(monkeypatch):
    """pywinauto falso. `state['windows']` pode mudar entre as consultas (janela que demora a abrir)."""
    state = {"windows": [], "polls": 0, "appear_after": 0, "late": None}

    class Desktop:
        def __init__(self, backend=None):
            assert backend == "uia"  # a ordem de preferência manda usar UI Automation

        def windows(self):
            state["polls"] += 1
            if state["late"] and state["polls"] > state["appear_after"]:
                return state["windows"] + [state["late"]]
            return list(state["windows"])

    sent: list = []
    pw = types.ModuleType("pywinauto")
    pw.Desktop = Desktop
    kb = types.ModuleType("pywinauto.keyboard")
    kb.send_keys = lambda keys, **kw: sent.append((keys, kw))
    monkeypatch.setitem(sys.modules, "pywinauto", pw)
    monkeypatch.setitem(sys.modules, "pywinauto.keyboard", kb)
    state["sent"] = sent
    return state


@pytest.fixture
def pyautogui(monkeypatch):
    pg = types.ModuleType("pyautogui")
    pg.FAILSAFE, pg.PAUSE = False, 0
    pg.FailSafeException = type("FailSafeException", (Exception,), {})
    pg.calls, pg.screen, pg.raise_failsafe = [], (1920, 1080), False
    pg.size = lambda: pg.screen

    def click(**kw):
        if pg.raise_failsafe:
            raise pg.FailSafeException()
        pg.calls.append(("click", kw))

    pg.click = click
    pg.hotkey = lambda *keys, **kw: pg.calls.append(("hotkey", keys, kw))
    monkeypatch.setitem(sys.modules, "pyautogui", pg)
    return pg


# ---------- abrir aplicativo (funciona de verdade em qualquer SO) ----------
class TestOpenApp:
    def test_abre_um_programa_de_verdade_e_devolve_o_pid(self):
        out = run("windows.open_app", {"application": "sleep", "arguments": "30"})["outputs"]
        try:
            os.kill(out["pid"], 0)  # está vivo
            assert out["application"].endswith("sleep")
        finally:
            os.kill(out["pid"], signal.SIGKILL)

    def test_o_programa_aberto_sobrevive_ao_motor(self):
        # iniciado em sessão própria (start_new_session): não é derrubado junto com quem o abriu
        out = run("windows.open_app", {"application": "sleep", "arguments": "30"})["outputs"]
        try:
            assert os.getsid(out["pid"]) == out["pid"]
        finally:
            os.kill(out["pid"], signal.SIGKILL)

    @pytest.mark.parametrize("app", ["programa-que-nao-existe-xyz", "/caminho/que/nao/existe/app"])
    def test_nao_encontrado(self, app):
        e = err("windows.open_app", {"application": app})
        assert e.code == "APP_NOT_FOUND" and "notepad.exe" in e.message or "não existe" in e.message

    def test_argumentos_com_aspas_sem_fechar(self):
        assert err("windows.open_app", {"application": "sleep", "arguments": '"abc'}).code == "INVALID_CONFIG"

    def test_sem_shell_metacaracteres_nao_sao_interpretados(self, tmp_path):
        # se um shell interpretasse isto, criaria o arquivo; sem shell, "; touch" é só texto para o programa
        marker = tmp_path / "pwned"
        out = run("windows.open_app", {"application": "sleep", "arguments": f"0.1; touch {marker}"})["outputs"]
        try:
            time.sleep(0.4)
            assert not marker.exists()
        finally:
            try:
                os.kill(out["pid"], signal.SIGKILL)
            except ProcessLookupError:
                pass

    def test_split_args_no_estilo_windows(self, on_windows):
        assert win.split_args('--flag "C:\\Meus Docs\\a.txt" b') == ["--flag", "C:\\Meus Docs\\a.txt", "b"]
        assert win.split_args("   ") == []

    def test_exige_administrador_vira_mensagem_clara(self, monkeypatch):
        def boom(*a, **k):
            e = OSError(13, "A operação solicitada requer elevação")
            e.winerror = 740
            raise e

        monkeypatch.setattr(win.subprocess, "Popen", boom)
        e = err("windows.open_app", {"application": "sleep"})
        assert e.code == "APP_START_FAILED" and "administrador" in e.message


# ---------- ativar janela ----------
class TestActivateWindow:
    def test_fora_do_windows(self):
        e = err("windows.activate_window", {"title": "Bloco"})
        assert e.code == "UNSUPPORTED_PLATFORM" and "só funciona no Windows" in e.message

    def test_acha_por_trecho_sem_diferenciar_maiusculas_e_traz_para_frente(self, on_windows, desktop):
        w = FakeWindow("Sem título – Bloco de Notas")
        desktop["windows"] = [FakeWindow("Outra"), w]
        out = run("windows.activate_window", {"title": "BLOCO de notas", "timeoutSeconds": 1})["outputs"]
        assert out == {"title": "Sem título – Bloco de Notas", "handle": 4242, "pid": 99}
        assert w.calls == ["focus"]

    def test_restaura_janela_minimizada(self, on_windows, desktop):
        w = FakeWindow("Calculadora", minimized=True)
        desktop["windows"] = [w]
        run("windows.activate_window", {"title": "calc", "timeoutSeconds": 1})
        assert w.calls == ["restore", "focus"]

    def test_espera_a_janela_aparecer(self, on_windows, desktop):
        desktop["late"], desktop["appear_after"] = FakeWindow("Bloco de Notas"), 2
        out = run("windows.activate_window", {"title": "Bloco", "timeoutSeconds": 5})["outputs"]
        assert out["title"] == "Bloco de Notas" and desktop["polls"] >= 3

    def test_nao_encontrada_apos_o_tempo(self, on_windows, desktop):
        t0 = time.monotonic()
        e = err("windows.activate_window", {"title": "Fantasma", "timeoutSeconds": 0.4})
        assert e.code == "WINDOW_NOT_FOUND" and "Fantasma" in e.message and time.monotonic() - t0 < 2

    def test_falha_ao_focar_explica_o_caso_do_administrador(self, on_windows, desktop):
        desktop["windows"] = [FakeWindow("App Admin", focus_error=RuntimeError("acesso negado"))]
        e = err("windows.activate_window", {"title": "App Admin", "timeoutSeconds": 1})
        assert e.code == "WINDOW_ACTIVATION_FAILED" and "administrador" in e.message

    def test_cancelar_durante_a_espera(self, on_windows, desktop):
        ran = Ran()
        ran.cancel.set()
        with pytest.raises(ActionCancelled):
            run("windows.activate_window", {"title": "X", "timeoutSeconds": 30}, ran)

    @pytest.mark.parametrize("bad", [-1, 99999, "abc", True])
    def test_timeout_invalido(self, on_windows, desktop, bad):
        assert err("windows.activate_window", {"title": "X", "timeoutSeconds": bad}).code == "INVALID_CONFIG"

    def test_sem_pywinauto(self, on_windows, monkeypatch):
        monkeypatch.setitem(sys.modules, "pywinauto", None)  # import falha
        assert err("windows.activate_window", {"title": "X", "timeoutSeconds": 1}).code == "DEPENDENCY_MISSING"

    def test_janela_que_some_durante_a_enumeracao_nao_quebra(self, on_windows, desktop):
        class Flaky(FakeWindow):
            def window_text(self):
                raise RuntimeError("COMError")

        good = FakeWindow("Alvo")
        desktop["windows"] = [Flaky("x"), good]
        assert run("windows.activate_window", {"title": "alvo", "timeoutSeconds": 1})["outputs"]["title"] == "Alvo"


# ---------- digitar texto ----------
class TestTypeText:
    def test_escapa_os_caracteres_especiais_do_send_keys(self):
        assert inp.escape_send_keys("a+b^c%d~e(f){g}") == "a{+}b{^}c{%}d{~}e{(}f{)}{{}g{}}"
        assert inp.escape_send_keys("Olá, ação! ç ñ") == "Olá, ação! ç ñ"  # acentos passam intactos

    def test_digita_em_blocos_com_espacos_tabs_e_quebras_de_linha(self, on_windows, desktop):
        out = run("input.type_text", {"text": "x" * 100})["outputs"]
        sent = desktop["sent"]
        assert out["length"] == 100 and [len(k) for k, _ in sent] == [40, 40, 20]
        assert all(kw["with_spaces"] and kw["with_tabs"] and kw["with_newlines"] for _, kw in sent)

    def test_texto_especial_chega_escapado(self, on_windows, desktop):
        run("input.type_text", {"text": "1+1=2 (ok)"})
        assert desktop["sent"][0][0] == "1{+}1=2 {(}ok{)}"

    def test_numero_vira_texto(self, on_windows, desktop):
        run("input.type_text", {"text": 42})
        assert desktop["sent"][0][0] == "42"

    @pytest.mark.parametrize("bad", ["", None, True])
    def test_vazio_e_obrigatorio(self, bad):
        assert err("input.type_text", {"text": bad}).code == "INVALID_CONFIG"

    def test_limite_de_tamanho(self):
        assert err("input.type_text", {"text": "x" * 5001}).code == "INVALID_CONFIG"

    def test_cancelamento_entre_blocos_para_de_digitar(self, on_windows, desktop):
        ran = Ran()
        from pywinauto import keyboard

        original = keyboard.send_keys

        def and_cancel(keys, **kw):
            original(keys, **kw)
            ran.cancel.set()  # usuário cancela depois do primeiro bloco

        keyboard.send_keys = and_cancel
        with pytest.raises(ActionCancelled):
            run("input.type_text", {"text": "x" * 200}, ran)
        assert len(desktop["sent"]) == 1  # parou: não digitou os outros 160 caracteres

    def test_fora_do_windows(self):
        assert err("input.type_text", {"text": "oi"}).code == "UNSUPPORTED_PLATFORM"


# ---------- atalhos ----------
class TestHotkey:
    @pytest.mark.parametrize("text,expected", [
        ("ctrl+s", ["ctrl", "s"]),
        ("Ctrl + Shift + S", ["ctrl", "shift", "s"]),
        ("s+ctrl", ["ctrl", "s"]),  # modificadores sempre primeiro
        ("Control+Alt+Delete", ["ctrl", "alt", "delete"]),
        ("win+r", ["win", "r"]),
        ("f5", ["f5"]),
        ("alt+F4", ["alt", "f4"]),
        ("windows+escape", ["win", "esc"]),
    ])
    def test_parser_valido(self, text, expected):
        assert inp.parse_hotkey(text) == expected

    @pytest.mark.parametrize("text", ["", "   ", "ctrl+", "+s", "ctrl+ctrl+s", "ctrl+shift", "a+b", "ctrl+banana", "ctrl+f25", "ctrl+;"])
    def test_parser_invalido(self, text):
        with pytest.raises(ActionError) as e:
            inp.parse_hotkey(text)
        assert e.value.code == "INVALID_CONFIG"

    def test_envia_as_teclas_na_ordem(self, on_windows, pyautogui):
        out = run("input.hotkey", {"keys": "s+shift+ctrl"})["outputs"]
        assert out["keys"] == ["shift", "ctrl", "s"]  # modificadores primeiro (na ordem escrita), tecla principal por último
        assert pyautogui.calls[0][:2] == ("hotkey", ("shift", "ctrl", "s"))
        assert pyautogui.FAILSAFE is True  # parada de emergência ligada

    def test_failsafe_vira_erro_claro(self, on_windows, pyautogui):
        def boom(*a, **k):
            raise pyautogui.FailSafeException()

        pyautogui.hotkey = boom
        assert err("input.hotkey", {"keys": "ctrl+c"}).code == "FAILSAFE_TRIGGERED"

    def test_fora_do_windows_e_validado_antes(self):
        assert err("input.hotkey", {"keys": "banana"}).code == "INVALID_CONFIG"  # config ruim é reportada primeiro
        assert err("input.hotkey", {"keys": "ctrl+s"}).code == "UNSUPPORTED_PLATFORM"


# ---------- clique ----------
class TestClick:
    def test_clique_esquerdo_direito_e_duplo(self, on_windows, pyautogui):
        run("input.click", {"x": 100, "y": 200, "button": "left"})
        run("input.click", {"x": 1, "y": 2, "button": "right"})
        run("input.click", {"x": 5, "y": 6, "button": "double"})
        calls = [c[1] for c in pyautogui.calls]
        assert calls[0] == {"x": 100, "y": 200, "button": "left", "clicks": 1, "interval": 0.1}
        assert calls[1]["button"] == "right" and calls[2]["clicks"] == 2

    def test_botao_padrao_e_esquerdo_e_float_inteiro_e_aceito(self, on_windows, pyautogui):
        run("input.click", {"x": 10.0, "y": 20})
        assert pyautogui.calls[0][1]["button"] == "left" and pyautogui.calls[0][1]["x"] == 10

    @pytest.mark.parametrize("cfg", [{"x": -1, "y": 0}, {"x": 1.5, "y": 0}, {"x": "a", "y": 0}, {"x": 0}, {"x": True, "y": 0}, {"x": 0, "y": 0, "button": "meio"}])
    def test_configuracao_invalida(self, on_windows, pyautogui, cfg):
        assert err("input.click", cfg).code == "INVALID_CONFIG"
        assert not pyautogui.calls

    def test_fora_da_tela_explica_resolucao_e_escala(self, on_windows, pyautogui):
        e = err("input.click", {"x": 1920, "y": 10})
        assert e.code == "COORDINATES_OUT_OF_SCREEN" and "1920x1080" in e.message and "escala" in e.message
        assert not pyautogui.calls  # não clicou

    def test_failsafe(self, on_windows, pyautogui):
        pyautogui.raise_failsafe = True
        assert err("input.click", {"x": 1, "y": 1}).code == "FAILSAFE_TRIGGERED"

    def test_sem_pyautogui(self, on_windows, monkeypatch):
        monkeypatch.setitem(sys.modules, "pyautogui", None)
        assert err("input.click", {"x": 1, "y": 1}).code == "DEPENDENCY_MISSING"

    def test_ambiente_sem_tela(self, on_windows, monkeypatch):
        class Broken:
            def __getattr__(self, n):
                raise KeyError("DISPLAY")

        monkeypatch.setitem(sys.modules, "pyautogui", None)
        real_import = __import__

        def fake_import(name, *a, **k):
            if name == "pyautogui":
                raise RuntimeError("sem display")
            return real_import(name, *a, **k)

        monkeypatch.setattr("builtins.__import__", fake_import)
        e = err("input.click", {"x": 1, "y": 1})
        assert e.code == "DEPENDENCY_UNAVAILABLE" and "sem display" in e.message
