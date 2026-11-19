import threading
import time

import pytest

import automation_engine.actions  # noqa: F401
from automation_engine.actions import vision
from automation_engine.actions.vision import Line, Word, find_best, normalize
from automation_engine.runtime.context import ActionCancelled, ActionError
from helpers import Ran, run


def line(*words: tuple[str, int, int, int, int]) -> Line:
    ws = tuple(Word(*w) for w in words)
    return Line(" ".join(w.text for w in ws), ws)


SCREEN = [
    line(("Arquivo", 10, 5, 50, 14), ("Editar", 70, 5, 40, 14), ("Exibir", 120, 5, 38, 14)),
    line(("Salvar", 100, 200, 44, 16), ("como...", 150, 200, 48, 16)),
    line(("Promptpa", 40, 300, 60, 14), ("Oque", 106, 300, 30, 14), ("é", 140, 300, 8, 14), ("endereço", 152, 300, 60, 14)),
]


class Fake:
    def __init__(self, frames):
        self.frames = list(frames)
        self.calls = 0
        self.regions = []

    def read(self, region):
        self.regions.append(region)
        self.calls += 1
        return self.frames[min(self.calls - 1, len(self.frames) - 1)]


@pytest.fixture(autouse=True)
def reset():
    yield
    vision.set_backend(None)


def code(fn):
    with pytest.raises(ActionError) as e:
        fn()
    return e.value


class TestMatching:
    def test_normaliza_acentos_caixa_e_espacos(self):
        assert normalize("  SALVAR   Cómo ") == "salvar como"

    def test_acha_palavra_e_frase_com_a_caixa_unida(self):
        m = find_best(SCREEN, "Editar", 0.8)
        assert (m.x, m.y, m.width, m.height, m.similarity) == (70, 5, 40, 14, 1.0)
        m = find_best(SCREEN, "salvar como", 0.8)
        assert (m.x, m.y, m.width) == (100, 200, 98)  # "Salvar" + "como..." (ruído de pontuação tolerado)
        assert m.similarity >= 0.8

    def test_tolera_ruido_de_ocr_pelo_limiar(self):
        assert find_best(SCREEN, "Prompt para", 0.8) is not None  # OCR juntou as palavras: 0,84 passa no limiar 0,8
        assert find_best(SCREEN, "Prompt para", 0.9) is None  # e um limiar mais exigente recusa
        assert find_best(SCREEN, "Promptpa", 0.95) is not None
        assert find_best(SCREEN, "Promptp", 0.8) is not None  # letra a menos

    def test_limiar_alto_recusa_e_baixo_aceita_o_mesmo_texto(self):
        assert find_best(SCREEN, "Exibr", 0.95) is None
        assert find_best(SCREEN, "Exibr", 0.8) is not None

    def test_nao_inventa_quando_nao_ha_nada_parecido(self):
        assert find_best(SCREEN, "Configurações avançadas", 0.8) is None
        assert find_best([], "x", 0.8) is None
        assert find_best(SCREEN, "   ", 0.8) is None


class TestAction:
    def test_devolve_posicao_centro_e_similaridade(self):
        vision.set_backend(Fake([SCREEN]))
        out = run("vision.find_text", {"text": "Editar"})
        o = out["outputs"]
        assert (o["x"], o["y"], o["width"], o["height"]) == (70, 5, 40, 14)
        assert (o["centerX"], o["centerY"]) == (90, 12)
        assert o["similarity"] == 1.0 and o["attempts"] == 1 and o["matchedText"] == "Editar"

    def test_espera_o_texto_aparecer_e_conta_as_tentativas(self):
        vision.set_backend(Fake([[], [], SCREEN]))
        t0 = time.monotonic()
        out = run("vision.find_text", {"text": "Salvar como", "timeoutSeconds": 5})
        assert out["outputs"]["attempts"] == 3
        assert 0.8 < time.monotonic() - t0 < 4

    def test_nao_encontrou_no_prazo_da_erro_claro_sem_vazar_o_que_foi_lido(self):
        vision.set_backend(Fake([SCREEN]))
        e = code(lambda: run("vision.find_text", {"text": "Imprimir", "timeoutSeconds": 1}))
        assert e.code == "TEXT_NOT_FOUND_ON_SCREEN"
        assert "Imprimir" in e.message and "similaridade" in e.message
        assert "Promptpa" not in e.message and "Arquivo" not in e.message  # texto da tela pode ser sensível
        assert e.details["attempts"] >= 2 and 0 <= e.details["bestSimilarity"] < 0.8

    def test_cancelar_a_espera_responde_rapido(self):
        vision.set_backend(Fake([[]]))
        ran = Ran()
        threading.Timer(0.4, ran.cancel.set).start()
        t0 = time.monotonic()
        with pytest.raises(ActionCancelled):
            run("vision.find_text", {"text": "nunca", "timeoutSeconds": 60}, ran)
        assert time.monotonic() - t0 < 2

    def test_regiao_e_repassada_ao_backend(self):
        f = Fake([SCREEN])
        vision.set_backend(f)
        run("vision.find_text", {"text": "Editar", "regionX": 0, "regionY": 0, "regionWidth": 300, "regionHeight": 40})
        assert f.regions == [(0, 0, 300, 40)]
        f2 = Fake([SCREEN])
        vision.set_backend(f2)
        run("vision.find_text", {"text": "Editar"})
        assert f2.regions == [None]  # tela inteira por padrão

    @pytest.mark.parametrize(
        "cfg",
        [
            {},
            {"text": "   "},
            {"text": "x" * 201},
            {"text": "a", "similarity": 0.1},
            {"text": "a", "similarity": 1.5},
            {"text": "a", "timeoutSeconds": -1},
            {"text": "a", "regionWidth": 100},  # largura sem altura
            {"text": "a", "regionX": 10},  # origem sem tamanho
            {"text": "a", "regionX": -1, "regionWidth": 5, "regionHeight": 5},
            {"text": "a", "regionX": 1.5, "regionWidth": 5, "regionHeight": 5},
        ],
    )
    def test_config_invalida(self, cfg):
        vision.set_backend(Fake([SCREEN]))
        assert code(lambda: run("vision.find_text", cfg)).code == "INVALID_CONFIG"

    def test_numero_vira_texto(self):
        vision.set_backend(Fake([[line(("2026", 10, 10, 30, 12))]]))
        assert run("vision.find_text", {"text": 2026})["outputs"]["matchedText"] == "2026"

    def test_sem_backend_fora_do_windows_diz_que_so_existe_no_windows(self):
        import sys

        if sys.platform == "win32":
            pytest.skip("só Linux/macOS")
        e = code(lambda: run("vision.find_text", {"text": "a"}))
        assert e.code == "UNSUPPORTED_PLATFORM" and "Windows" in e.message
