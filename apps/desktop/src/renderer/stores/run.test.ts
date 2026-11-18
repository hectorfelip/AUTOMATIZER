import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@automation-studio/shared-types";
import { reduce } from "./run";

const at = "2026-01-01T00:00:00.000Z";
const idle = { executionId: null, running: false, workflowName: "", rows: [], finished: null, startError: null };
const apply = (events: ExecutionEvent[], s: Parameters<typeof reduce>[0] = idle) => events.reduce((acc, e) => ({ ...acc, ...reduce(acc, e) }), s);

const started = (id = "e1"): ExecutionEvent => ({ type: "execution_started", executionId: id, at, workflowName: "Fluxo", nodeCount: 3 });

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
});
