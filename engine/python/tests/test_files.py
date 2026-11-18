import json
import os
from pathlib import Path

import pytest

from automation_engine.actions import paths
from automation_engine.runtime.context import ActionCancelled, ActionError
from helpers import Ran, run

TERMINAL = {"action_completed", "action_failed", "action_cancelled"}


def make(folder: Path, **files: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (folder / name.replace("__", ".")).write_text(content)


def err(action: str, config: dict) -> ActionError:
    with pytest.raises(ActionError) as e:
        run(action, config)
    return e.value


# ---------- caminhos ----------
class TestPaths:
    def test_relativo_e_rejeitado_com_exemplo(self):
        e = err("files.list", {"path": "relativo/pasta"})
        assert e.code == "INVALID_CONFIG" and "caminho completo" in e.message

    def test_nul_e_rejeitado(self):
        assert err("files.exists", {"path": "/tmp/a\x00b"}).code == "INVALID_CONFIG"

    def test_expande_til_e_variaveis_de_ambiente(self, tmp_path, monkeypatch):
        monkeypatch.setenv("HOME", str(tmp_path))
        monkeypatch.setenv("MINHA_PASTA", str(tmp_path))
        make(tmp_path, a__txt="x")
        assert run("files.list", {"path": "~"})["outputs"]["count"] == 1
        assert run("files.list", {"path": "$MINHA_PASTA"})["outputs"]["count"] == 1

    def test_campo_obrigatorio_vazio(self):
        e = err("files.exists", {"path": "   "})
        assert e.code == "INVALID_CONFIG" and "obrigatório" in e.message

    def test_padrao_curinga_e_colchetes_sao_literais(self):
        m = paths.compile_pattern("rel[1]*.pdf")
        assert m("rel[1]-final.pdf") and not m("rel1-final.pdf") and not m("rel[1]-final.docx")
        assert paths.compile_pattern("a?c")("abc") and not paths.compile_pattern("a?c")("abbc")


# ---------- files.list ----------
class TestList:
    def test_lista_so_arquivos_com_filtro_e_metadados(self, tmp_path):
        make(tmp_path, a__pdf="1", b__PDF="22", c__txt="333")
        (tmp_path / "sub").mkdir()
        out = run("files.list", {"path": str(tmp_path), "pattern": "*.pdf"})["outputs"]
        assert out["count"] == (2 if paths.is_windows() else 1)  # no Linux o filtro diferencia maiúsculas
        first = out["files"][0]
        assert first["name"] == "a.pdf" and first["extension"] == "pdf" and first["size"] == 1
        assert first["path"] == str(tmp_path / "a.pdf") and first["modifiedAt"]

    def test_padrao_vazio_lista_tudo_e_nao_inclui_pastas(self, tmp_path):
        make(tmp_path, a__txt="x", b__txt="y")
        (tmp_path / "pasta").mkdir()
        assert run("files.list", {"path": str(tmp_path), "pattern": ""})["outputs"]["count"] == 2

    def test_recursivo(self, tmp_path):
        make(tmp_path, a__txt="x")
        make(tmp_path / "s1" / "s2", b__txt="y")
        assert run("files.list", {"path": str(tmp_path)})["outputs"]["count"] == 1
        assert run("files.list", {"path": str(tmp_path), "recursive": True})["outputs"]["count"] == 2

    def test_limite_de_itens_marca_truncado_e_ainda_conta_o_total(self, tmp_path, monkeypatch):
        from automation_engine.actions import files

        monkeypatch.setattr(files, "MAX_LISTED", 3)
        make(tmp_path, **{f"f{i}__txt": "x" for i in range(10)})
        out = run("files.list", {"path": str(tmp_path)})["outputs"]
        assert out["count"] == 10 and len(out["files"]) == 3 and out["truncated"] is True

    def test_pasta_inexistente_e_arquivo_no_lugar_de_pasta(self, tmp_path):
        assert err("files.list", {"path": str(tmp_path / "nao")}).code == "PATH_NOT_FOUND"
        make(tmp_path, a__txt="x")
        assert err("files.list", {"path": str(tmp_path / "a.txt")}).code == "NOT_A_DIRECTORY"

    def test_cancelamento(self, tmp_path):
        make(tmp_path, a__txt="x")
        ran = Ran()
        ran.cancel.set()
        with pytest.raises(ActionCancelled):
            run("files.list", {"path": str(tmp_path), "recursive": True}, ran)

    def test_resultado_cabe_no_protocolo(self, tmp_path):
        make(tmp_path, **{f"arquivo_com_nome_comprido_{i:05d}__txt": "x" for i in range(2000)})
        out = run("files.list", {"path": str(tmp_path)})
        assert len(json.dumps(out)) < 1024 * 1024  # 1 MiB é o limite de uma mensagem


# ---------- files.exists / create_folder ----------
class TestExistsAndFolder:
    def test_exists_escolhe_a_saida(self, tmp_path):
        make(tmp_path, a__txt="x")
        f = run("files.exists", {"path": str(tmp_path / "a.txt")})
        d = run("files.exists", {"path": str(tmp_path)})
        n = run("files.exists", {"path": str(tmp_path / "x")})
        assert (f["next"], f["outputs"]["kind"]) == ("true", "file")
        assert (d["next"], d["outputs"]["kind"]) == ("true", "folder")
        assert (n["next"], n["outputs"]["kind"], n["outputs"]["exists"]) == ("false", None, False)

    def test_cria_pastas_intermediarias_e_e_idempotente(self, tmp_path):
        target = tmp_path / "a" / "b" / "c"
        assert run("files.create_folder", {"path": str(target)})["outputs"]["created"] is True
        assert target.is_dir()
        again = run("files.create_folder", {"path": str(target)})
        assert again["outputs"]["created"] is False and "já existia" in again["message"]

    def test_arquivo_com_o_mesmo_nome(self, tmp_path):
        make(tmp_path, nome="x")
        e = err("files.create_folder", {"path": str(tmp_path / "nome")})
        assert e.code == "DESTINATION_EXISTS" and "arquivo" in e.message


# ---------- copiar e mover ----------
@pytest.mark.parametrize("action", ["files.copy", "files.move"])
class TestTransfer:
    def survives(self, action: str, path: Path) -> bool:
        return path.exists() if action == "files.copy" else not path.exists()

    def test_arquivo_para_pasta_existente_mantem_o_nome(self, action, tmp_path):
        make(tmp_path / "in", a__txt="conteúdo")
        (tmp_path / "out").mkdir()
        res = run(action, {"source": str(tmp_path / "in" / "a.txt"), "destination": str(tmp_path / "out")})
        assert (tmp_path / "out" / "a.txt").read_text() == "conteúdo"
        assert self.survives(action, tmp_path / "in" / "a.txt")
        assert res["outputs"]["count"] == 1 and res["outputs"]["items"][0]["destination"] == str(tmp_path / "out" / "a.txt")

    def test_arquivo_para_novo_nome_cria_pastas_que_faltam(self, action, tmp_path):
        make(tmp_path, a__txt="x")
        run(action, {"source": str(tmp_path / "a.txt"), "destination": str(tmp_path / "novo" / "sub" / "b.txt")})
        assert (tmp_path / "novo" / "sub" / "b.txt").read_text() == "x"

    def test_destino_terminado_em_barra_e_pasta(self, action, tmp_path):
        make(tmp_path, a__txt="x")
        run(action, {"source": str(tmp_path / "a.txt"), "destination": str(tmp_path / "pasta_nova") + os.sep})
        assert (tmp_path / "pasta_nova" / "a.txt").exists()

    def test_curinga_age_em_todos_os_correspondentes(self, action, tmp_path):
        make(tmp_path / "in", a__pdf="1", b__pdf="2", c__txt="3")
        res = run(action, {"source": str(tmp_path / "in" / "*.pdf"), "destination": str(tmp_path / "out")})
        assert sorted(p.name for p in (tmp_path / "out").iterdir()) == ["a.pdf", "b.pdf"]
        assert res["outputs"]["count"] == 2
        assert (tmp_path / "in" / "c.txt").exists()  # não correspondeu: intocado
        assert self.survives(action, tmp_path / "in" / "a.pdf")

    def test_curinga_sem_correspondencia_nao_e_erro(self, action, tmp_path):
        make(tmp_path / "in", a__txt="1")
        res = run(action, {"source": str(tmp_path / "in" / "*.pdf"), "destination": str(tmp_path / "out")})
        assert res["outputs"]["count"] == 0 and "Nenhum arquivo corresponde" in res["message"]
        assert not (tmp_path / "out").exists()

    def test_conflito_sem_sobrescrever_nao_altera_nada(self, action, tmp_path):
        make(tmp_path / "in", a__txt="novo-a", b__txt="novo-b")
        make(tmp_path / "out", b__txt="antigo-b")  # só b conflita
        e = err(action, {"source": str(tmp_path / "in" / "*.txt"), "destination": str(tmp_path / "out")})
        assert e.code == "DESTINATION_EXISTS" and "Nada foi alterado" in e.message
        assert not (tmp_path / "out" / "a.txt").exists()  # atômico: a nem chegou a ser copiado
        assert (tmp_path / "out" / "b.txt").read_text() == "antigo-b"
        assert (tmp_path / "in" / "a.txt").exists() and (tmp_path / "in" / "b.txt").exists()

    def test_sobrescrever_substitui_e_informa(self, action, tmp_path):
        make(tmp_path / "in", a__txt="novo")
        make(tmp_path / "out", a__txt="antigo")
        res = run(action, {"source": str(tmp_path / "in" / "a.txt"), "destination": str(tmp_path / "out"), "overwrite": True})
        assert (tmp_path / "out" / "a.txt").read_text() == "novo"
        assert res["outputs"]["overwritten"] == 1 and "substituído" in res["message"]

    def test_mesmo_arquivo(self, action, tmp_path):
        make(tmp_path, a__txt="x")
        e = err(action, {"source": str(tmp_path / "a.txt"), "destination": str(tmp_path / "a.txt"), "overwrite": True})
        assert e.code == "SAME_PATH"
        assert (tmp_path / "a.txt").read_text() == "x"  # nada foi destruído

    @pytest.mark.parametrize("case,code", [("missing", "PATH_NOT_FOUND"), ("folder", "IS_A_DIRECTORY")])
    def test_origem_invalida(self, action, tmp_path, case, code):
        (tmp_path / "pasta").mkdir()
        src = tmp_path / ("nao_existe.txt" if case == "missing" else "pasta")
        assert err(action, {"source": str(src), "destination": str(tmp_path / "d")}).code == code

    def test_curinga_exige_destino_pasta_e_nao_aceita_curinga_em_pasta(self, action, tmp_path):
        make(tmp_path / "in", a__txt="1")
        make(tmp_path, destino__txt="arquivo")
        e = err(action, {"source": str(tmp_path / "in" / "*.txt"), "destination": str(tmp_path / "destino.txt")})
        assert e.code == "NOT_A_DIRECTORY"
        e2 = err(action, {"source": str(tmp_path / "*" / "a.txt"), "destination": str(tmp_path / "d")})
        assert e2.code == "INVALID_CONFIG" and "só pode aparecer no nome" in e2.message

    def test_cancelado_antes_de_comecar_nao_toca_em_nada(self, action, tmp_path):
        make(tmp_path / "in", a__txt="1")
        ran = Ran()
        ran.cancel.set()
        with pytest.raises(ActionCancelled):
            run(action, {"source": str(tmp_path / "in" / "a.txt"), "destination": str(tmp_path / "out")}, ran)
        assert (tmp_path / "in" / "a.txt").exists() and not (tmp_path / "out" / "a.txt").exists()

    def test_progresso_em_lote(self, action, tmp_path):
        make(tmp_path / "in", **{f"f{i}__txt": "x" for i in range(4)})
        ran = Ran()
        run(action, {"source": str(tmp_path / "in" / "*.txt"), "destination": str(tmp_path / "out")}, ran)
        assert [p for p, _ in ran.progress] == [25.0, 50.0, 75.0, 100.0]

    def test_falha_no_meio_informa_quantos_ja_foram(self, action, tmp_path, monkeypatch):
        import shutil

        make(tmp_path / "in", a__txt="1", b__txt="2", c__txt="3")
        real = shutil.move if action == "files.move" else shutil.copy2
        calls = {"n": 0}

        def flaky(s, t):
            calls["n"] += 1
            if calls["n"] == 2:
                raise PermissionError(13, "negado", s)
            return real(s, t)

        monkeypatch.setattr(shutil, "move" if action == "files.move" else "copy2", flaky)
        e = err(action, {"source": str(tmp_path / "in" / "*.txt"), "destination": str(tmp_path / "out")})
        assert e.code == "PERMISSION_DENIED" and e.details["completed"] == 1 and "1 de 3" in e.message


# ---------- renomear ----------
class TestRename:
    def test_renomeia_arquivo_e_pasta(self, tmp_path):
        make(tmp_path, a__txt="x")
        (tmp_path / "dir").mkdir()
        out = run("files.rename", {"path": str(tmp_path / "a.txt"), "newName": "b.txt"})["outputs"]
        assert out == {"oldPath": str(tmp_path / "a.txt"), "path": str(tmp_path / "b.txt")}
        run("files.rename", {"path": str(tmp_path / "dir"), "newName": "dir2"})
        assert (tmp_path / "b.txt").exists() and (tmp_path / "dir2").is_dir()

    @pytest.mark.parametrize("name", ["", "   ", ".", "..", "x/y", "x\\y"])
    def test_nomes_invalidos(self, tmp_path, name):
        make(tmp_path, a__txt="x")
        assert err("files.rename", {"path": str(tmp_path / "a.txt"), "newName": name}).code == "INVALID_CONFIG"

    def test_regras_do_windows_so_valem_no_windows(self, tmp_path, monkeypatch):
        make(tmp_path, a__txt="x")
        run("files.rename", {"path": str(tmp_path / "a.txt"), "newName": "relatorio:final"}) if os.name != "nt" else None
        monkeypatch.setattr(paths, "is_windows", lambda: True)
        make(tmp_path, b__txt="x")
        for bad in ['a<b', 'a"b', "nome.", "nome ", "CON", "con.txt", "LPT1"]:
            assert err("files.rename", {"path": str(tmp_path / "b.txt"), "newName": bad}).code == "INVALID_CONFIG", bad

    def test_conflito_inexistente_e_mesmo_nome(self, tmp_path):
        make(tmp_path, a__txt="x", b__txt="y")
        assert err("files.rename", {"path": str(tmp_path / "a.txt"), "newName": "b.txt"}).code == "DESTINATION_EXISTS"
        assert (tmp_path / "b.txt").read_text() == "y"  # não sobrescreveu
        assert err("files.rename", {"path": str(tmp_path / "x.txt"), "newName": "z.txt"}).code == "PATH_NOT_FOUND"
        assert err("files.rename", {"path": str(tmp_path / "a.txt"), "newName": "a.txt"}).code == "SAME_PATH"


# ---------- pelo protocolo real ----------
def test_move_pelo_processo_do_motor(engine, tmp_path):
    make(tmp_path / "in", a__pdf="1", b__pdf="2")
    engine.execute("files.move", {"source": str(tmp_path / "in" / "*.pdf"), "destination": str(tmp_path / "out")})
    done = engine.collect_until(TERMINAL)[-1]
    assert done["type"] == "action_completed" and done["payload"]["outputs"]["count"] == 2
    assert sorted(p.name for p in (tmp_path / "out").iterdir()) == ["a.pdf", "b.pdf"]


def test_erro_de_arquivo_chega_com_codigo_pelo_protocolo(engine, tmp_path):
    engine.execute("files.list", {"path": str(tmp_path / "nao_existe")})
    e = engine.collect_until(TERMINAL)[-1]["payload"]["error"]
    assert e["code"] == "PATH_NOT_FOUND" and "nao_existe" in e["message"]
