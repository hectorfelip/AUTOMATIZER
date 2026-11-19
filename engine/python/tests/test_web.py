"""Ações web contra páginas de demonstração locais (servidor HTTP em 127.0.0.1), com o Chromium de verdade."""

import glob
import http.server
import os
import threading
import time
from pathlib import Path

import pytest

pytest.importorskip("playwright", reason="playwright não instalado (engine/python/requirements-web.txt)")

import automation_engine.actions  # noqa: E402,F401
from automation_engine.actions import web  # noqa: E402
from automation_engine.runtime import registry  # noqa: E402
from automation_engine.runtime.context import ActionCancelled, ActionContext, ActionError  # noqa: E402
from helpers import Ran, run  # noqa: E402


def _browser() -> str | None:
    env = os.environ.get("AUTOMATION_BROWSER_PATH")
    if env:
        return env
    found = sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux*/chrome"))
    return found[-1] if found else None


BROWSER = _browser()
pytestmark = pytest.mark.skipif(BROWSER is None, reason="nenhum Chromium disponível (defina AUTOMATION_BROWSER_PATH)")

INDEX = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Demo</title></head><body>
<h1 id="titulo">Página de demonstração</h1>
<ul id="lista"><li class="item" data-id="a">Um</li><li class="item" data-id="b">Dois</li><li class="item" data-id="c">Três</li></ul>
<input id="nome" aria-label="Nome" value="">
<button id="botao" onclick="document.getElementById('saida').textContent='clicado'">Clicar</button>
<div id="saida"></div>
<button id="tarde" onclick="setTimeout(()=>{const d=document.createElement('p');d.id='depois';d.textContent='apareceu';document.body.appendChild(d)},700)">Carregar depois</button>
<p id="some" style="display:none">oculto</p>
</body></html>"""


@pytest.fixture(scope="module")
def site(tmp_path_factory):
    root = tmp_path_factory.mktemp("site")
    (root / "index.html").write_text(INDEX, encoding="utf-8")

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(root), **k)

        def log_message(self, *args):  # sem ruído nos testes
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


@pytest.fixture(autouse=True)
def browser_env(monkeypatch):
    monkeypatch.setenv("AUTOMATION_BROWSER_PATH", BROWSER or "")
    monkeypatch.setenv("AUTOMATION_BROWSER_NO_SANDBOX", "1")
    yield
    # fecha qualquer sessão deixada por um teste e espera o worker processar
    for eid in list(web._worker.sessions):
        web._worker.submit(lambda e=eid: web._worker.close_session(e)).result(timeout=10)


def code(fn):
    with pytest.raises(ActionError) as e:
        fn()
    return e.value.code


def test_navegar_extrair_texto_lista_e_atributo(site):
    out = run("web.navigate", {"url": site + "/index.html"})
    assert out["outputs"]["title"] == "Demo" and out["outputs"]["status"] == 200
    assert run("web.extract", {"selector": "#titulo"})["outputs"]["text"] == "Página de demonstração"
    itens = run("web.extract", {"selector": ".item"})["outputs"]
    assert itens["items"] == ["Um", "Dois", "Três"] and itens["count"] == 3 and itens["text"] == "Um"
    assert run("web.extract", {"selector": ".item", "attribute": "data-id"})["outputs"]["items"] == ["a", "b", "c"]
    # seletor por texto/papel (sem coordenadas)
    assert run("web.extract", {"selector": "role=button[name='Clicar']"})["outputs"]["count"] == 1


def test_clicar_preencher_e_ler_de_volta(site):
    run("web.navigate", {"url": site + "/index.html"})
    run("web.click", {"selector": "#botao"})
    assert run("web.extract", {"selector": "#saida"})["outputs"]["text"] == "clicado"
    run("web.fill", {"selector": "#nome", "text": "Olá, mundo"})
    assert run("web.extract", {"selector": "#nome", "attribute": "value"})["outputs"]["text"] == "Olá, mundo"


def test_esperar_elemento_que_aparece_depois_e_estados(site):
    run("web.navigate", {"url": site + "/index.html"})
    run("web.click", {"selector": "#tarde"})
    t0 = time.monotonic()
    run("web.wait", {"selector": "#depois", "timeoutSeconds": 5})
    assert 0.4 < time.monotonic() - t0 < 4
    run("web.wait", {"selector": "#some", "state": "hidden", "timeoutSeconds": 3})
    assert code(lambda: run("web.wait", {"selector": "#some", "state": "visible", "timeoutSeconds": 1})) == "ELEMENT_NOT_FOUND"
    assert code(lambda: run("web.wait", {"selector": "#x", "state": "qualquer"})) == "INVALID_CONFIG"


def test_elemento_inexistente_da_erro_claro_no_prazo(site):
    run("web.navigate", {"url": site + "/index.html"})
    t0 = time.monotonic()
    with pytest.raises(ActionError) as e:
        run("web.click", {"selector": "#nao-existe", "timeoutSeconds": 1})
    assert e.value.code == "ELEMENT_NOT_FOUND" and "#nao-existe" in e.value.message
    assert time.monotonic() - t0 < 4


def test_sem_pagina_aberta(site):
    assert code(lambda: run("web.click", {"selector": "#botao"})) == "NO_BROWSER"
    assert run("web.close", {})["outputs"] == {"closed": False}


@pytest.mark.parametrize("url", ["", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://x.com/a", "http://", "//x.com", "x.com"])
def test_url_invalida_ou_perigosa_recusada(url):
    assert code(lambda: run("web.navigate", {"url": url})) == "INVALID_CONFIG"
    assert not web._worker.sessions  # nem abriu navegador


def test_http_404_e_servidor_fora_do_ar(site):
    assert code(lambda: run("web.navigate", {"url": site + "/nao-existe.html"})) == "HTTP_ERROR"
    assert code(lambda: run("web.navigate", {"url": "http://127.0.0.1:1/", "timeoutSeconds": 5})) == "NAVIGATION_FAILED"


def test_config_invalida():
    assert code(lambda: run("web.click", {"selector": ""})) == "INVALID_CONFIG"
    assert code(lambda: run("web.click", {"selector": "x" * 1001})) == "INVALID_CONFIG"
    assert code(lambda: run("web.wait", {"selector": "#a", "timeoutSeconds": -1})) == "INVALID_CONFIG"
    assert code(lambda: run("web.navigate", {"url": "http://127.0.0.1/", "timeoutSeconds": 9999})) == "INVALID_CONFIG"


def test_preencher_nunca_repete_o_texto_na_mensagem(site):
    run("web.navigate", {"url": site + "/index.html"})
    r = run("web.fill", {"selector": "#nome", "text": "senha-super-secreta"})
    assert "secreta" not in r["message"] and r["outputs"]["length"] == len("senha-super-secreta")


def test_cancelar_espera_longa_responde_em_menos_de_um_segundo(site):
    run("web.navigate", {"url": site + "/index.html"})
    ran = Ran()
    threading.Timer(0.6, ran.cancel.set).start()
    t0 = time.monotonic()
    with pytest.raises(ActionCancelled):
        run("web.wait", {"selector": "#nunca", "timeoutSeconds": 60}, ran)
    assert time.monotonic() - t0 < 2.5
    # o navegador continua utilizável depois do cancelamento
    assert run("web.extract", {"selector": "#titulo"})["outputs"]["count"] == 1


def test_sessoes_isoladas_por_execucao_e_fechadas_pelo_gancho_de_fim(site):
    def go(eid):
        ctx = ActionContext(eid, "n", {"url": site + "/index.html"}, threading.Event(), lambda p, m: None)
        return registry.get_action("web.navigate")(ctx)

    go("exec-A")
    go("exec-B")
    assert set(web._worker.sessions) == {"exec-A", "exec-B"}
    registry.run_execution_end("exec-A")  # o app manda `cancel` ao fim da execução
    deadline = time.monotonic() + 10
    while "exec-A" in web._worker.sessions and time.monotonic() < deadline:
        time.sleep(0.05)
    assert set(web._worker.sessions) == {"exec-B"}
    # a execução B continua funcionando
    ctx = ActionContext("exec-B", "n", {"selector": "#titulo"}, threading.Event(), lambda p, m: None)
    assert registry.get_action("web.extract")(ctx)["outputs"]["count"] == 1


def test_web_close_fecha_e_o_proximo_no_precisa_abrir_de_novo(site):
    run("web.navigate", {"url": site + "/index.html"})
    assert run("web.close", {})["outputs"] == {"closed": True}
    assert code(lambda: run("web.extract", {"selector": "#titulo"})) == "NO_BROWSER"


def test_navegador_ausente_da_mensagem_clara(site, monkeypatch):
    monkeypatch.setenv("AUTOMATION_BROWSER_PATH", "/nao/existe/chrome")
    with pytest.raises(ActionError) as e:
        run("web.navigate", {"url": site + "/index.html"})
    assert e.value.code == "BROWSER_UNAVAILABLE" and "navegador" in e.value.message


def _chromium_procs() -> int:
    import subprocess

    r = subprocess.run(["pgrep", "-fc", "playwright_chromiumdev_profile"], capture_output=True, text=True)
    return int(r.stdout.strip() or 0)


@pytest.mark.skipif(os.name != "posix", reason="usa pgrep")
def test_pelo_motor_real_o_fim_da_execucao_fecha_o_navegador_e_o_encerramento_nao_deixa_orfaos(site, engine):
    base = _chromium_procs()
    engine.execute("web.navigate", {"url": site + "/index.html"}, execution_id="exec-web")
    done = engine.collect_until({"action_completed", "action_failed"}, timeout=40)[-1]
    assert done["type"] == "action_completed", done
    assert done["payload"]["outputs"]["title"] == "Demo"
    assert _chromium_procs() > base  # navegador aberto
    engine.send("cancel", "end-1", {"executionId": "exec-web"})  # o app faz isto quando a execução termina
    engine.recv("cancel_ack")
    deadline = time.monotonic() + 10
    while _chromium_procs() > base and time.monotonic() < deadline:
        time.sleep(0.1)
    assert _chromium_procs() == base  # fechado pelo gancho de fim de execução

    engine.execute("web.navigate", {"url": site + "/index.html"}, execution_id="exec-2", request_id="x2")  # reabre sob demanda
    assert engine.collect_until({"action_completed", "action_failed"}, timeout=40)[-1]["type"] == "action_completed"
    assert _chromium_procs() > base
    engine.send("shutdown", "bye-1")  # encerrar o motor com navegador aberto
    assert engine.wait_exit(15) == 0
    deadline = time.monotonic() + 10
    while _chromium_procs() > base and time.monotonic() < deadline:
        time.sleep(0.1)
    assert _chromium_procs() == base
