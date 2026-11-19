import random
import threading
import time

import pytest

pytest.importorskip("PIL")
from PIL import Image  # noqa: E402

import automation_engine.actions  # noqa: F401,E402
from automation_engine.actions import vision_image as vi  # noqa: E402
from automation_engine.runtime.context import ActionCancelled, ActionError  # noqa: E402
from helpers import Ran, run  # noqa: E402


def noise(w: int, h: int, seed: int) -> Image.Image:
    r = random.Random(seed)
    im = Image.new("L", (w, h))
    im.putdata([r.randrange(256) for _ in range(w * h)])
    return im.convert("RGB")


def icon(w: int = 40, h: int = 32, seed: int = 7) -> Image.Image:
    """Ícone com estrutura (blocos), não ruído puro: sobrevive à redução da etapa grossa."""
    im = Image.new("RGB", (w, h), (240, 240, 240))
    r = random.Random(seed)
    for _ in range(6):
        x, y = r.randrange(w - 8), r.randrange(h - 8)
        im.paste((r.randrange(120), r.randrange(120), r.randrange(256)), (x, y, x + r.randrange(6, 16), y + r.randrange(6, 16)))
    return im


def desktop(w: int = 480, h: int = 300) -> Image.Image:
    """Fundo com textura suave + blocos, como uma tela de verdade (não ruído branco)."""
    im = Image.new("RGB", (w, h), (30, 60, 90))
    r = random.Random(1)
    for _ in range(40):
        x, y = r.randrange(w - 30), r.randrange(h - 30)
        im.paste((r.randrange(256), r.randrange(256), r.randrange(256)), (x, y, x + r.randrange(10, 60), y + r.randrange(10, 40)))
    return im


class FakeScreen:
    def __init__(self, frames):
        self.frames = list(frames)
        self.calls = 0
        self.regions = []

    def capture(self, region):
        self.regions.append(region)
        self.calls += 1
        im = self.frames[min(self.calls - 1, len(self.frames) - 1)]
        return im.crop((region[0], region[1], region[0] + region[2], region[1] + region[3])) if region else im


@pytest.fixture(autouse=True)
def reset():
    yield
    vi.set_screen(None)


@pytest.fixture
def ref(tmp_path):
    p = tmp_path / "ref.png"
    icon().save(p)
    return str(p)


def with_icon_at(x: int, y: int, base=None, tpl=None) -> Image.Image:
    s = (base or desktop()).copy()
    s.paste(tpl or icon(), (x, y))
    return s


def code(fn):
    with pytest.raises(ActionError) as e:
        fn()
    return e.value


class TestMatching:
    @pytest.mark.parametrize("pos", [(0, 0), (37, 53), (200, 101), (440, 268), (3, 268)])
    def test_acha_na_posicao_exata_inclusive_fora_da_grade_e_nas_bordas(self, pos):
        found, _ = vi.find_image(with_icon_at(*pos), vi.Template(icon()), 0.9)
        assert found is not None and (found.x, found.y) == pos and found.similarity == 1.0

    def test_nao_inventa_quando_a_imagem_nao_esta_na_tela(self):
        found, seen = vi.find_image(desktop(), vi.Template(icon(seed=99)), 0.9)
        assert found is None and seen < 0.9

    def test_tolera_brilho_e_ruido_leve_mas_um_limiar_alto_recusa(self):
        s = with_icon_at(150, 90)
        r = random.Random(3)
        px = s.load()
        for _ in range(250):  # sal e pimenta em 250 pixels da tela
            px[r.randrange(s.width), r.randrange(s.height)] = (r.randrange(256),) * 3
        found, _ = vi.find_image(s, vi.Template(icon()), 0.8)
        assert found is not None and (found.x, found.y) == (150, 90) and 0.8 <= found.similarity < 1.0
        assert vi.find_image(s, vi.Template(icon()), 1.0)[0] is None

    def test_com_duas_copias_ficam_com_a_mais_parecida(self):
        s = with_icon_at(300, 200, with_icon_at(20, 20))
        s.paste((255, 0, 0), (25, 25, 35, 35))  # estraga a primeira cópia
        found, _ = vi.find_image(s, vi.Template(icon()), 0.7)
        assert (found.x, found.y) == (300, 200)

    def test_icone_escuro_em_fundo_claro_nao_casa_com_fundo_liso(self):
        # 1 − diff/255 daria ~0,8 aqui (pouca área escura) e passaria num limiar frouxo; a métrica normalizada cai para ~0,4
        tpl = Image.new("RGB", (40, 40), (255, 255, 255))
        tpl.paste((0, 0, 0), (10, 10, 22, 22))
        found, seen = vi.find_image(Image.new("RGB", (200, 120), (255, 255, 255)), vi.Template(tpl), 0.6)
        assert found is None and seen < 0.5

    def test_modelo_maior_que_a_tela_nao_quebra(self):
        assert vi.find_image(Image.new("RGB", (20, 20), (9, 9, 9)), vi.Template(icon()), 0.9) == (None, 0.0)

    def test_modelo_liso_e_recusado(self):
        e = code(lambda: vi.Template(Image.new("RGB", (30, 30), (200, 200, 200))))
        assert e.code == "INVALID_CONFIG" and "sem detalhes" in e.message

    def test_modelo_grande_na_tela_cheia_e_rapido_o_bastante(self):
        big = desktop(1920, 1080)
        tpl = Image.new("RGB", (96, 96), (240, 240, 240))
        r = random.Random(5)
        for _ in range(10):
            x, y = r.randrange(70), r.randrange(70)
            tpl.paste((r.randrange(256),) * 3, (x, y, x + r.randrange(8, 25), y + r.randrange(8, 25)))
        big.paste(tpl, (1234, 777))
        t0 = time.monotonic()
        found, _ = vi.find_image(big, vi.Template(tpl), 0.9)
        assert (found.x, found.y) == (1234, 777)
        assert time.monotonic() - t0 < 10  # folga: CI lento; no dev é ~1 s

    def test_cancelamento_interrompe_a_busca(self):
        def tick():
            raise ActionCancelled()

        with pytest.raises(ActionCancelled):
            vi.find_image(with_icon_at(10, 10), vi.Template(icon()), 0.9, tick)


class TestAction:
    def test_devolve_posicao_centro_e_similaridade(self, ref):
        vi.set_screen(FakeScreen([with_icon_at(120, 80)]))
        o = run("vision.find_image", {"imagePath": ref})["outputs"]
        assert (o["x"], o["y"], o["width"], o["height"]) == (120, 80, 40, 32)
        assert (o["centerX"], o["centerY"]) == (140, 96) and o["similarity"] == 1.0 and o["attempts"] == 1

    def test_regiao_soma_a_origem_e_e_repassada(self, ref):
        s = FakeScreen([with_icon_at(300, 200)])
        vi.set_screen(s)
        o = run("vision.find_image", {"imagePath": ref, "regionX": 250, "regionY": 150, "regionWidth": 200, "regionHeight": 140})["outputs"]
        assert (o["x"], o["y"]) == (300, 200) and s.regions == [(250, 150, 200, 140)]

    def test_espera_a_imagem_aparecer(self, ref):
        vi.set_screen(FakeScreen([desktop(), desktop(), with_icon_at(60, 60)]))
        t0 = time.monotonic()
        o = run("vision.find_image", {"imagePath": ref, "timeoutSeconds": 6})["outputs"]
        assert o["attempts"] == 3 and (o["x"], o["y"]) == (60, 60) and time.monotonic() - t0 > 0.8

    def test_nao_encontrou_da_erro_claro(self, ref):
        vi.set_screen(FakeScreen([desktop()]))
        e = code(lambda: run("vision.find_image", {"imagePath": ref, "timeoutSeconds": 1}))
        assert e.code == "IMAGE_NOT_FOUND_ON_SCREEN" and "similaridade" in e.message and e.details["attempts"] >= 2

    def test_cancelar_a_espera_responde_rapido(self, ref):
        vi.set_screen(FakeScreen([desktop()]))
        ran = Ran()
        threading.Timer(0.5, ran.cancel.set).start()
        t0 = time.monotonic()
        with pytest.raises(ActionCancelled):
            run("vision.find_image", {"imagePath": ref, "timeoutSeconds": 60}, ran)
        assert time.monotonic() - t0 < 3

    @pytest.mark.parametrize("cfg", [{}, {"imagePath": "  "}, {"imagePath": "relativo.png"}, {"imagePath": 5}])
    def test_config_invalida(self, cfg):
        vi.set_screen(FakeScreen([desktop()]))
        assert code(lambda: run("vision.find_image", cfg)).code == "INVALID_CONFIG"

    @pytest.mark.parametrize("extra", [{"similarity": 0.2}, {"similarity": 1.2}, {"timeoutSeconds": -1}, {"regionWidth": 10}])
    def test_numeros_invalidos(self, ref, extra):
        vi.set_screen(FakeScreen([desktop()]))
        assert code(lambda: run("vision.find_image", {"imagePath": ref, **extra})).code == "INVALID_CONFIG"

    def test_arquivo_inexistente_extensao_errada_corrompido_e_grande(self, tmp_path):
        vi.set_screen(FakeScreen([desktop()]))
        assert code(lambda: run("vision.find_image", {"imagePath": str(tmp_path / "nao.png")})).code == "PATH_NOT_FOUND"
        assert code(lambda: run("vision.find_image", {"imagePath": str(tmp_path)})).code == "INVALID_CONFIG"  # sem extensão de imagem
        (tmp_path / "pasta.png").mkdir()
        assert code(lambda: run("vision.find_image", {"imagePath": str(tmp_path / "pasta.png")})).code == "PATH_NOT_FOUND"
        (tmp_path / "x.txt").write_text("oi")
        assert code(lambda: run("vision.find_image", {"imagePath": str(tmp_path / "x.txt")})).code == "INVALID_CONFIG"
        (tmp_path / "falso.png").write_bytes(b"isto nao e uma imagem")
        assert code(lambda: run("vision.find_image", {"imagePath": str(tmp_path / "falso.png")})).code == "INVALID_CONFIG"
        (tmp_path / "grande.png").write_bytes(b"0" * (vi.MAX_FILE_BYTES + 1))
        assert "máximo" in code(lambda: run("vision.find_image", {"imagePath": str(tmp_path / "grande.png")})).message

    def test_tamanho_fora_dos_limites(self, tmp_path):
        vi.set_screen(FakeScreen([desktop()]))
        Image.new("RGB", (4, 4), (1, 2, 3)).save(tmp_path / "p.png")
        Image.new("RGB", (900, 20), (1, 2, 3)).save(tmp_path / "g.png")
        for n in ("p.png", "g.png"):
            assert code(lambda: run("vision.find_image", {"imagePath": str(tmp_path / n)})).code == "INVALID_CONFIG"

    def test_sem_tela_de_teste_so_roda_no_windows(self, ref, monkeypatch):
        monkeypatch.setattr("sys.platform", "linux")
        assert code(lambda: run("vision.find_image", {"imagePath": ref})).code == "UNSUPPORTED_PLATFORM"
