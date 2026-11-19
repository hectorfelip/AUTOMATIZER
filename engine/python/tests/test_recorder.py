import json
import os
import subprocess
import sys
import time

import pytest

from automation_engine.recorder import Processor
from conftest import ROOT


def feed(p: Processor, *raws):
    out = []
    for r in raws:
        out += p.feed(r)
    return out


def typed(text):
    return [r for ch in text for r in ({"k": "press", "key": ch}, {"k": "release", "key": ch})]


def combo(mods, key):
    return [*({"k": "press", "key": m} for m in mods), {"k": "press", "key": key}, {"k": "release", "key": key}, *({"k": "release", "key": m} for m in reversed(mods))]


class TestProcessor:
    def test_cliques_esquerdo_e_direito_so_no_pressionar(self):
        p = Processor()
        ev = feed(p, {"k": "click", "x": 10, "y": 20, "button": "left", "pressed": True}, {"k": "click", "x": 10, "y": 20, "button": "left", "pressed": False}, {"k": "click", "x": 5, "y": 6, "button": "right", "pressed": True}, {"k": "click", "x": 1, "y": 1, "button": "middle", "pressed": True})
        assert [(e["t"], e["x"], e["y"], e["button"]) for e in ev] == [("click", 10, 20, "left"), ("click", 5, 6, "right")]

    def test_texto_digitado_vira_caracteres_inclusive_espaco_e_maiuscula(self):
        ev = feed(Processor(), *typed("Oi a"[:2]), {"k": "press", "key": "space"}, *typed("a"))
        assert "".join(e["char"] for e in ev if e["t"] == "char") == "Oi a"

    def test_atalhos_com_ctrl_alt_win_viram_hotkey_na_ordem_ctrl_alt_shift_win(self):
        ev = feed(Processor(), *combo(["ctrl"], "s"), *combo(["ctrl", "shift"], "Esc".lower()), *combo(["win"], "r"))
        assert [e["keys"] for e in ev] == [["ctrl", "s"], ["ctrl", "shift", "esc"], ["win", "r"]]

    def test_teclas_nomeadas_viram_hotkey_e_shift_tab_funciona(self):
        ev = feed(Processor(), {"k": "press", "key": "enter"}, *combo(["shift"], "tab"), {"k": "press", "key": "page_down"}, {"k": "press", "key": "f5"})
        assert [e["keys"] for e in ev] == [["enter"], ["shift", "tab"], ["pagedown"], ["f5"]]

    def test_aliases_de_modificadores(self):
        ev = feed(Processor(), {"k": "press", "key": "ctrl_l"}, {"k": "press", "key": "alt_gr"}, {"k": "press", "key": "x"})
        assert ev[0]["keys"] == ["ctrl", "alt", "x"]

    def test_tecla_desconhecida_e_soltar_nao_geram_nada(self):
        assert feed(Processor(), {"k": "press", "key": "media_play_pause"}, {"k": "release", "key": "a"}, {"k": "press", "key": ""}, {"k": "scroll"}) == []

    def test_controles_globais_nunca_sao_gravados(self):
        p = Processor()
        assert [e["t"] for e in feed(p, *combo(["ctrl", "alt"], "p"))] == ["paused"]
        assert p.paused
        assert [e["t"] for e in feed(p, *combo(["ctrl", "alt"], "p"))] == ["paused"] and not p.paused
        assert [e["t"] for e in feed(p, *combo(["ctrl", "alt"], "r"))] == ["stop"]
        assert [(e["t"], e["on"]) for e in feed(p, *combo(["ctrl", "alt"], "s"))] == [("secret", True)]

    def test_pausado_ignora_cliques_e_teclas(self):
        p = Processor()
        feed(p, *combo(["ctrl", "alt"], "p"))
        assert feed(p, {"k": "click", "x": 1, "y": 1, "button": "left", "pressed": True}, *typed("abc"), {"k": "press", "key": "enter"}) == []

    def test_MODO_SENHA_nenhum_caractere_digitado_sai_do_processo(self):
        p = Processor()
        feed(p, *combo(["ctrl", "alt"], "s"))
        ev = feed(p, *typed("S3nh@-Secreta"), {"k": "press", "key": "space"})
        assert {e["t"] for e in ev} == {"secret_key"}
        assert "S3nh@" not in json.dumps(ev) and "Secreta" not in json.dumps(ev) and "char" not in json.dumps(ev)
        assert len(ev) == len("S3nh@-Secreta") + 1
        # Enter depois da senha é gravado (não é sensível), e sair do modo volta a gravar texto
        assert feed(p, {"k": "press", "key": "enter"})[0]["keys"] == ["enter"]
        feed(p, *combo(["ctrl", "alt"], "s"))
        assert [e["char"] for e in feed(p, *typed("ok"))] == ["o", "k"]

    def test_tempos_sao_monotonicos_com_relogio_injetado(self):
        t = [100.0]
        p = Processor(now=lambda: t[0])
        t[0] = 100.5
        a = feed(p, {"k": "press", "key": "a"})[0]["ms"]
        t[0] = 102.0
        b = feed(p, {"k": "press", "key": "b"})[0]["ms"]
        assert (a, b) == (500, 2000)


class TestProcesso:
    """O processo `--record` de verdade (fonte falsa de eventos, só com AUTOMATION_ENGINE_TEST_ACTIONS=1)."""

    def run(self, tmp_path, raws, extra_env=None, timeout=15):
        f = tmp_path / "ev.json"
        f.write_text(json.dumps(raws))
        env = {**os.environ, "PYTHONPATH": str(ROOT), "AUTOMATION_ENGINE_TEST_ACTIONS": "1", "AUTOMATION_RECORDER_FAKE": str(f), **(extra_env or {})}
        p = subprocess.run([sys.executable, "-m", "automation_engine", "--record"], input=b"", capture_output=True, cwd=ROOT, env=env, timeout=timeout)
        return p, [json.loads(l) for l in p.stdout.splitlines()]

    def test_emite_ready_eventos_e_bye_e_stdout_so_tem_json(self, tmp_path):
        raws = [
            {"k": "click", "x": 5, "y": 6, "button": "left", "pressed": True, "ms": 100},
            *[dict(r, ms=200 + i) for i, r in enumerate(typed("oi"))],
            *[dict(r, ms=1000) for r in combo(["ctrl", "alt"], "r")],
        ]
        p, ev = self.run(tmp_path, raws)
        assert p.returncode == 0
        assert [e["t"] for e in ev] == ["ready", "click", "char", "char", "stop", "bye"]
        assert ev[1] == {"t": "click", "x": 5, "y": 6, "button": "left", "ms": 100}

    def test_senha_nao_vaza_nem_em_stdout_nem_em_stderr(self, tmp_path):
        raws = [*combo(["ctrl", "alt"], "s"), *typed("SenhaUltraSecreta99"), *combo(["ctrl", "alt"], "r")]
        p, ev = self.run(tmp_path, raws)
        assert "SenhaUltra" not in p.stdout.decode() and "SenhaUltra" not in p.stderr.decode()
        assert [e["t"] for e in ev if e["t"] == "secret_key"] == ["secret_key"] * len("SenhaUltraSecreta99")

    def test_fonte_falsa_so_vale_com_a_variavel_de_teste(self, tmp_path):
        f = tmp_path / "ev.json"
        f.write_text("[]")
        env = {k: v for k, v in os.environ.items() if k != "AUTOMATION_ENGINE_TEST_ACTIONS"}
        env.update(PYTHONPATH=str(ROOT), AUTOMATION_RECORDER_FAKE=str(f))
        p = subprocess.run([sys.executable, "-m", "automation_engine", "--record"], input=b"", capture_output=True, cwd=ROOT, env=env, timeout=15)
        # em produção a fonte falsa é ignorada: tenta o pynput de verdade (e avisa se não houver) — nunca lê o arquivo
        out = [json.loads(l) for l in p.stdout.splitlines()]
        assert out and out[0]["t"] in ("ready", "error")
        assert all(e["t"] != "click" for e in out)

    def test_comando_stop_pelo_stdin_encerra(self, tmp_path):
        f = tmp_path / "ev.json"
        f.write_text("[]")
        env = {**os.environ, "PYTHONPATH": str(ROOT), "AUTOMATION_ENGINE_TEST_ACTIONS": "1", "AUTOMATION_RECORDER_FAKE": str(f)}
        proc = subprocess.Popen([sys.executable, "-m", "automation_engine", "--record"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, cwd=ROOT, env=env)
        proc.stdin.write(b"pause\nstop\n")
        proc.stdin.flush()
        out = proc.communicate(timeout=15)[0].decode()
        assert proc.returncode == 0 and '"t": "stop"' in out and '"t": "bye"' in out
