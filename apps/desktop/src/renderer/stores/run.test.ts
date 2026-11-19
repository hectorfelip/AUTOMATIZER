import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@automation-studio/shared-types";
import { currentNodeId, reduce, type RunView } from "./run";

const at = "2026-01-01T00:00:00.000Z";
const idle: RunView = { executionId: null, running: false, mode: "run", workflowName: "", rows: [], paused: null, pauseRequested: false, snapshot: null, finished: null, startError: null };
const apply = (events: ExecutionEvent[], s: RunView = idle) => events.reduce((acc, e) => ({ ...acc, ...reduce(acc, e) }), s);

const started = (id = "e1"): ExecutionEvent => ({ type: "execution_started", executionId: id, at, workflowName: "Fluxo", nodeCount: 3, mode: "run" });

describe("reduce (eventos de execução → estado da tela)", () => {
  it("acompanha uma execução do início ao fim", () => {
    const s = apply([
      started(),
      { type: "node_started", executionId: "e1", at, nodeId: "w", nodeType: "flow.wait", label: "Esperar" },
      { type: "node_progress", executionId: "e1", at, nodeId: "w", percent: 40, message: "Aguardando…" },
    ]);
    expect(s).toMatchObject({ executionId: "e1", running: true, workflowName: "Fluxo" });
    expect(s.rows).toEqual([{ nodeId: "w", label: "Esperar", state: "running", percent: 40, message: "Aguardando…" }]);
    const done = apply(
      [
        { type: "node_completed", executionId: "e1", at, nodeId: "w", port: "next", message: "Aguardou 2s." },
        { type: "execution_finished", executionId: "e1", at, status: "completed", durationMs: 2100 },
      ],
      s,
    );
    expect(done.running).toBe(false);
    expect(done.rows[0]).toMatchObject({ state: "completed", percent: undefined, message: "Aguardou 2s." });
    expect(done.finished).toMatchObject({ status: "completed", durationMs: 2100 });
  });

  it("falha de nó e da execução ficam visíveis", () => {
    const s = apply([
      started(),
      { type: "node_started", executionId: "e1", at, nodeId: "w", nodeType: "flow.wait", label: "Esperar" },
      { type: "node_failed", executionId: "e1", at, nodeId: "w", error: { code: "X", message: "deu ruim" } },
      { type: "execution_finished", executionId: "e1", at, status: "failed", durationMs: 5, error: { code: "X", message: "Esperar: deu ruim" } },
    ]);
    expect(s.rows[0]).toMatchObject({ state: "failed", message: "deu ruim" });
    expect(s.finished?.error?.message).toBe("Esperar: deu ruim");
  });

  it("ignora eventos de outra execução", () => {
    const s = apply([started("e1")]);
    const after = reduce(s, { type: "node_started", executionId: "OUTRA", at, nodeId: "x", nodeType: "t", label: "X" });
    expect(after).toBe(s);
  });

  it("uma nova execução substitui a anterior (adota o id pelo próprio evento, sem corrida com o invoke)", () => {
    const first = apply([started("e1"), { type: "execution_finished", executionId: "e1", at, status: "completed", durationMs: 1 }]);
    const second = apply([started("e2")], first);
    expect(second).toMatchObject({ executionId: "e2", running: true, rows: [], finished: null });
  });

  it("evento fora de ordem para nó desconhecido cria a linha em vez de quebrar", () => {
    const s = apply([started(), { type: "node_progress", executionId: "e1", at, nodeId: "n", percent: 10 }]);
    expect(s.rows).toHaveLength(1);
  });

  const snap = { variables: { n: 1 }, results: [], loops: [] };
  const mid = (): ExecutionEvent[] => [started(), { type: "node_started", executionId: "e1", at, nodeId: "a", nodeType: "t", label: "A" }];

  it("pausa: pedido, pausado (com contexto) e retomado; nó atual acompanha", () => {
    let s = apply(mid());
    expect(currentNodeId(s)).toBe("a");
    s = apply([{ type: "execution_pause_requested", executionId: "e1", at, nodeId: "a" }], s);
    expect(s.pauseRequested).toBe(true);
    s = apply([{ type: "node_completed", executionId: "e1", at, nodeId: "a", port: null }, { type: "execution_paused", executionId: "e1", at, nodeId: "b", label: "B", reason: "user", snapshot: snap }], s);
    expect(s).toMatchObject({ pauseRequested: false, paused: { nodeId: "b", label: "B", reason: "user" }, snapshot: snap });
    expect(currentNodeId(s)).toBe("b");
    s = apply([{ type: "execution_resumed", executionId: "e1", at }], s);
    expect(s.paused).toBeNull();
    expect(s.snapshot).toEqual(snap); // continua visível até o próximo ponto
  });

  it("falha tratada marca o nó como 'seguiu' e o fim guarda avisos, nó culpado e contexto final", () => {
    const s = apply([
      ...mid(),
      { type: "node_failed", executionId: "e1", at, nodeId: "a", error: { code: "X", message: "ruim" }, handled: "continued" },
      { type: "execution_finished", executionId: "e1", at, status: "completed_with_warnings", durationMs: 3, warnings: 1, snapshot: snap },
    ]);
    expect(s.rows[0]).toMatchObject({ state: "failed", handled: "continued" });
    expect(s.finished).toMatchObject({ status: "completed_with_warnings", warnings: 1 });
    expect(s.snapshot).toEqual(snap);
    expect(s.running).toBe(false);
    const f = apply([...mid(), { type: "execution_finished", executionId: "e1", at, status: "failed", durationMs: 1, failedNodeId: "a", error: { code: "X", message: "m" } }]);
    expect(f.finished?.failedNodeId).toBe("a");
  });

  it("o fim limpa pausa pendente; novo início zera pausa e contexto antigos", () => {
    const paused = apply([...mid(), { type: "execution_paused", executionId: "e1", at, nodeId: "b", label: "B", reason: "breakpoint", snapshot: snap }]);
    const done = apply([{ type: "execution_finished", executionId: "e1", at, status: "cancelled", durationMs: 1 }], paused);
    expect(done).toMatchObject({ paused: null, pauseRequested: false });
    expect(apply([started("e2")], paused)).toMatchObject({ paused: null, snapshot: null, executionId: "e2" });
  });
});
