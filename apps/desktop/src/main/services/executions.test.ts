import { describe, expect, it, vi } from "vitest";
import { defaultConfig, getNodeDefinition } from "@automation-studio/node-registry";
import type { ActionOutcome, ActionProgress, ActionRequest, EngineStatus, ExecutionEvent } from "@automation-studio/shared-types";
import { createEmptyWorkflow, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { AppError } from "./errors.js";
import { createExecutionManager, type EngineLike } from "./executions.js";

const READY: EngineStatus = { state: "ready", engineVersion: "t", python: "3.13.0", platform: "t", actions: [], optionalModules: {} };

function flow(seconds = 1): WorkflowDocument {
  const d = createEmptyWorkflow("f", "Teste");
  d.nodes.push({ id: "w", type: "flow.wait", version: 1, config: { ...defaultConfig(getNodeDefinition("flow.wait")!), seconds } });
  d.nodes.push({ id: "end", type: "flow.end", version: 1, config: {} });
  d.edges.push({ id: "e1", source: "start", sourceHandle: "next", target: "w", targetHandle: "input" });
  d.edges.push({ id: "e2", source: "w", sourceHandle: "next", target: "end", targetHandle: "input" });
  return d;
}

/** Motor falso: cada ação fica pendente até o teste resolvê-la, ou é cancelada por engine.cancel. */
function fakeEngine(status: EngineStatus = READY) {
  const pending: Array<{ req: ActionRequest; resolve: (o: ActionOutcome) => void; onProgress?: (p: ActionProgress) => void }> = [];
  const engine: EngineLike & { status: EngineStatus } = {
    status,
    executeAction: (req, onProgress) => new Promise((resolve) => pending.push({ req, resolve, onProgress })),
    cancel: vi.fn((executionId: string) => {
      for (const p of pending.splice(0)) if (p.req.executionId === executionId) p.resolve({ kind: "cancelled" });
    }),
  };
  return { engine, pending };
}
const setup = (status?: EngineStatus) => {
  const f = fakeEngine(status);
  const events: ExecutionEvent[] = [];
  const mgr = createExecutionManager({ engine: f.engine, emit: (e) => events.push(e), newId: () => "exec-1" });
  return { ...f, events, mgr };
};
const tick = () => new Promise((r) => setTimeout(r, 10));
const finished = (events: ExecutionEvent[]) => events.find((e) => e.type === "execution_finished");
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return "NO_ERROR";
};

describe("ExecutionManager", () => {
  it("executa até o fim e libera para a próxima execução", async () => {
    const { mgr, pending, events } = setup();
    expect(mgr.start(flow())).toEqual({ executionId: "exec-1" });
    await tick();
    expect(mgr.isRunning()).toBe(true);
    expect(pending[0]!.req).toMatchObject({ executionId: "exec-1", nodeId: "w", action: "flow.wait", config: { seconds: 1 } });
    pending[0]!.onProgress?.({ percent: 50 });
    pending[0]!.resolve({ kind: "completed", outputs: {} });
    await tick();
    expect(finished(events)).toMatchObject({ status: "completed" });
    expect(events.some((e) => e.type === "node_progress")).toBe(true);
    expect(mgr.isRunning()).toBe(false);
    expect(code(() => mgr.start(flow()))).toBe("NO_ERROR"); // pode iniciar outra
  });

  it("recusa quando o motor não está pronto, explicando o motivo", () => {
    for (const status of [{ state: "starting" }, { state: "restarting" }, { state: "unavailable", reason: "Python não encontrado" }] as EngineStatus[]) {
      const { mgr } = setup(status);
      expect(code(() => mgr.start(flow()))).toBe("ENGINE_UNAVAILABLE");
    }
    const { mgr } = setup({ state: "unavailable", reason: "Python não encontrado" });
    expect(() => mgr.start(flow())).toThrow(/Python não encontrado/);
  });

  it("recusa documento malformado e fluxo com erros de validação, sem tocar o motor", () => {
    const { mgr, pending } = setup();
    expect(code(() => mgr.start({ lixo: true }))).toBe("VALIDATION");
    const bad = flow();
    bad.nodes.find((n) => n.id === "w")!.config = { seconds: -5 };
    expect(() => mgr.start(bad)).toThrow(/1 erro e não pode ser executado/);
    expect(pending).toHaveLength(0);
    expect(mgr.isRunning()).toBe(false);
  });

  it("só uma execução por vez", async () => {
    const { mgr } = setup();
    mgr.start(flow());
    await tick();
    expect(code(() => mgr.start(flow()))).toBe("EXECUTION_BUSY");
  });

  it("cancelar propaga ao motor e termina como cancelado", async () => {
    const { mgr, events, engine } = setup();
    mgr.start(flow());
    await tick();
    mgr.cancel("exec-1");
    await tick();
    expect(engine.cancel).toHaveBeenCalledWith("exec-1");
    expect(finished(events)).toMatchObject({ status: "cancelled" });
    expect(mgr.isRunning()).toBe(false);
  });

  it("cancelar id desconhecido ou depois do fim → NOT_FOUND", async () => {
    const { mgr, pending } = setup();
    expect(code(() => mgr.cancel("x"))).toBe("NOT_FOUND");
    mgr.start(flow());
    await tick();
    pending[0]!.resolve({ kind: "completed", outputs: {} });
    await tick();
    expect(code(() => mgr.cancel("exec-1"))).toBe("NOT_FOUND");
  });

  it("falha do motor no meio vira falha da execução, não exceção", async () => {
    const { mgr, pending, events } = setup();
    mgr.start(flow());
    await tick();
    pending[0]!.resolve({ kind: "failed", error: { code: "ENGINE_CRASHED", message: "O motor de automação encerrou inesperadamente." } });
    await tick();
    expect(finished(events)).toMatchObject({ status: "failed", error: { code: "ENGINE_CRASHED" } });
    expect(mgr.isRunning()).toBe(false);
  });

  it("timeout global cancela a ação no motor", async () => {
    const { mgr, events, engine } = setup();
    const d = flow();
    d.settings.timeoutSeconds = 1;
    mgr.start(d);
    await new Promise((r) => setTimeout(r, 1200));
    expect(engine.cancel).toHaveBeenCalledWith("exec-1");
    expect(finished(events)).toMatchObject({ status: "failed", error: { code: "TIMEOUT" } });
  });

  it("listener de evento que lança não quebra a execução", async () => {
    const f = fakeEngine();
    const mgr = createExecutionManager({ engine: f.engine, emit: () => { throw new Error("renderer morreu"); }, newId: () => "x" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mgr.start(flow());
    await tick();
    f.pending[0]!.resolve({ kind: "completed", outputs: {} });
    await tick();
    expect(mgr.isRunning()).toBe(false);
  });

  it("shutdown cancela a execução em curso", async () => {
    const { mgr, events } = setup();
    mgr.start(flow());
    await tick();
    mgr.shutdown();
    await tick();
    expect(finished(events)).toMatchObject({ status: "cancelled" });
  });
});
