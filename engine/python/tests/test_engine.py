import json
import subprocess
import sys

from conftest import ROOT, EngineProc

TERMINAL = {"action_completed", "action_failed", "action_cancelled"}


def test_ready_handshake(engine):
    p = engine.ready["payload"]
    assert engine.ready["eventId"] == 1 and engine.ready["requestId"] == ""
    assert p["protocolVersion"] == 1 and p["engineVersion"]
    assert "flow.wait" in p["actions"]
    assert set(p["optionalModules"]) == {"pywinauto", "pyautogui"}


def test_ping_pong_echoes_request_id(engine):
    engine.send("ping", "hb-7")
    pong = engine.recv("pong")
    assert pong["requestId"] == "hb-7" and pong["payload"]["activeExecutions"] == 0


def test_event_ids_increase(engine):
    for i in range(3):
        engine.send("ping", f"p{i}")
    ids = [engine.recv("pong")["eventId"] for _ in range(3)]
    assert ids == sorted(ids) and len(set(ids)) == 3


def test_execute_wait_emits_started_progress_completed(engine):
    engine.execute("flow.wait", {"seconds": 1.5})
    msgs = engine.collect_until(TERMINAL, 6)
    assert [m["type"] for m in msgs][0] == "action_started"
    assert any(m["type"] == "action_progress" and m["payload"]["percent"] == 100.0 for m in msgs)
    done = msgs[-1]
    assert done["type"] == "action_completed" and done["requestId"] == "x1"
    assert done["payload"] == {"executionId": "e1", "nodeId": "n1", "status": "success", "outputs": {"waitedSeconds": 1.5}, "message": "Aguardou 1.5s."}


def test_zero_seconds_completes_immediately(engine):
    engine.execute("flow.wait", {"seconds": 0})
    assert engine.collect_until(TERMINAL)[-1]["type"] == "action_completed"


def test_invalid_config_is_reported(engine):
    for bad in ("abc", -1, True, None, 999999):
        engine.execute("flow.wait", {"seconds": bad})
        err = engine.collect_until(TERMINAL)[-1]
        assert err["type"] == "action_failed" and err["payload"]["error"]["code"] == "INVALID_CONFIG", bad


def test_unknown_action(engine):
    engine.execute("nao.existe")
    err = engine.collect_until(TERMINAL)[-1]["payload"]["error"]
    assert err["code"] == "ACTION_NOT_IMPLEMENTED" and "nao.existe" in err["message"]


def test_cancel_stops_wait_promptly(engine):
    engine.execute("flow.wait", {"seconds": 60})
    engine.recv("action_started")
    engine.send("cancel", "c1", {"executionId": "e1"})
    ack = engine.recv("cancel_ack")
    assert ack["payload"] == {"executionId": "e1", "found": True}
    msg = engine.recv("action_cancelled", timeout=2)  # cooperativo: bem antes dos 60 s
    assert msg["payload"]["executionId"] == "e1"


def test_cancel_unknown_execution(engine):
    engine.send("cancel", "c1", {"executionId": "fantasma"})
    assert engine.recv("cancel_ack")["payload"]["found"] is False


def test_cancel_only_targets_that_execution(engine):
    engine.execute("flow.wait", {"seconds": 60}, "e1", "x1")
    engine.execute("flow.wait", {"seconds": 0}, "e2", "x2")
    done = engine.recv("action_completed")
    assert done["payload"]["executionId"] == "e2"
    engine.send("cancel", "c", {"executionId": "e1"})
    assert engine.recv("action_cancelled", timeout=2)["payload"]["executionId"] == "e1"


def test_second_action_in_same_execution_is_busy(engine):
    engine.execute("flow.wait", {"seconds": 30}, "e1", "x1")
    engine.recv("action_started")
    engine.execute("flow.wait", {"seconds": 0}, "e1", "x2")
    err = engine.recv("action_failed")
    assert err["requestId"] == "x2" and err["payload"]["error"]["code"] == "BUSY"
    engine.send("cancel", "c", {"executionId": "e1"})
    engine.recv("action_cancelled", timeout=2)


def test_ping_answers_while_action_runs(engine):
    engine.execute("flow.wait", {"seconds": 30})
    engine.recv("action_started")
    engine.send("ping", "hb")
    pong = engine.recv("pong", timeout=1)
    assert pong["payload"]["activeExecutions"] == 1
    engine.send("cancel", "c", {"executionId": "e1"})
    engine.recv("action_cancelled", timeout=2)


def test_malformed_input_never_kills_the_engine(engine):
    for line in (b"isto nao e json\n", b"[1,2,3]\n", b'"string"\n', b"{}\n", b'{"type":"voar","requestId":"a","payload":{}}\n',
                 b'{"type":"ping","payload":{}}\n', b'{"type":"ping","requestId":"a","payload":[]}\n', b"\xff\xfe\n", b'{"type":"execute_action","requestId":"a","payload":{}}\n'):
        engine.send_raw(line)
        assert engine.recv("protocol_error")["payload"]["message"], line
    engine.send("ping", "ainda-vivo")
    assert engine.recv("pong")["requestId"] == "ainda-vivo"


def test_oversize_line_is_discarded_and_engine_survives(engine):
    engine.send_raw(b'{"type":"ping","requestId":"a","payload":{"x":"' + b"a" * (1024 * 1024 + 10) + b'"}}\n')
    assert "1 MiB" in engine.recv("protocol_error")["payload"]["message"]
    engine.send("ping", "depois")
    assert engine.recv("pong")["requestId"] == "depois"


def test_blank_lines_are_ignored(engine):
    engine.send_raw(b"\n   \n")
    engine.send("ping", "p")
    assert engine.recv("pong")


def test_print_in_action_does_not_corrupt_protocol(engine):
    engine.execute("test.noise")
    assert engine.collect_until(TERMINAL)[-1]["type"] == "action_completed"
    engine.send("ping")
    engine.recv("pong")
    for line in engine.raw_stdout:  # stdout só tem protocolo
        assert json.loads(line)["type"]
    assert not any(b"RUIDO" in line for line in engine.raw_stdout)
    engine.close()
    err = "".join(engine.stderr_lines)
    assert "RUIDO NO STDOUT" in err and "ruído no stderr" in err  # o ruído foi parar no stderr


def test_bug_in_action_becomes_safe_internal_error(engine):
    engine.execute("test.boom")
    err = engine.collect_until(TERMINAL)[-1]["payload"]["error"]
    assert err["code"] == "INTERNAL_ERROR"
    assert "segredo" not in err["message"]  # mensagem ao usuário não vaza detalhes
    assert err["details"]["type"] == "RuntimeError" and "segredo" in err["details"]["trace"]
    engine.send("ping")
    assert engine.recv("pong")  # motor segue vivo


def test_action_error_carries_code_and_details(engine):
    engine.execute("test.fail")
    err = engine.collect_until(TERMINAL)[-1]["payload"]["error"]
    assert err == {"code": "TEST_FAILURE", "message": "Falha de teste.", "details": {"nodeId": "n1"}}


def test_unserializable_result(engine):
    engine.execute("test.unserializable")
    assert engine.collect_until(TERMINAL)[-1]["payload"]["error"]["code"] == "OUTPUT_NOT_SERIALIZABLE"


def test_large_result_within_limit(engine):
    engine.execute("test.big", {"size": 500_000})
    done = engine.collect_until(TERMINAL)[-1]
    assert len(done["payload"]["outputs"]["blob"]) == 500_000


def test_non_ascii_survives_round_trip(engine):
    engine.send("cancel", "ação-ç", {"executionId": "naõ-existe-✓"})
    ack = engine.recv("cancel_ack")
    assert ack["requestId"] == "ação-ç" and ack["payload"]["executionId"] == "naõ-existe-✓"


def test_shutdown_says_bye_and_exits_cleanly(engine):
    engine.execute("flow.wait", {"seconds": 60})
    engine.recv("action_started")
    engine.send("shutdown", "bye-1")
    assert engine.recv("bye")["requestId"] == "bye-1"
    assert engine.wait_exit() == 0


def test_stdin_eof_exits_cleanly(engine):
    engine.proc.stdin.close()  # o Main morreu
    assert engine.wait_exit() == 0


def test_hard_crash_is_visible_to_the_parent(engine):
    engine.execute("test.crash")
    assert engine.wait_exit() == 7


def test_test_actions_absent_without_flag():
    import os

    env = {**os.environ, "PYTHONPATH": str(ROOT)}
    env.pop("AUTOMATION_ENGINE_TEST_ACTIONS", None)
    out = subprocess.run([sys.executable, "-m", "automation_engine"], input=b'{"type":"shutdown","requestId":"s","payload":{}}\n', capture_output=True, cwd=ROOT, env=env, timeout=10).stdout
    ready = json.loads(out.splitlines()[0])
    assert ready["payload"]["actions"] == ["flow.wait"]


def test_selftest_prints_one_json_line():
    out = subprocess.run([sys.executable, "-m", "automation_engine", "--selftest"], capture_output=True, cwd=ROOT, timeout=10)
    data = json.loads(out.stdout)
    assert set(data["imports"]) == {"pywinauto", "pyautogui"} and data["python"]
