import { describe, expect, it, vi } from "vitest";
import {
  defaultConfig,
  getNodeDefinition,
} from "@automation-studio/node-registry";
import type {
  ActionOutcome,
  ActionProgress,
  ActionRequest,
  EngineStatus,
  ExecutionEvent,
} from "@automation-studio/shared-types";
import {
  createEmptyWorkflow,
  type WorkflowDocument,
} from "@automation-studio/workflow-schema";
import { AppError } from "./errors.js";
import { openDatabase } from "../database/db.js";
import { createAutomationService } from "./automations.js";
import { createExecutionManager, type EngineLike } from "./executions.js";
import { createHistoryService } from "./history.js";
import { createWorkflowService } from "./workflows.js";

const READY: EngineStatus = {
  state: "ready",
  engineVersion: "t",
  python: "3.13.0",
  platform: "t",
  actions: [],
  optionalModules: {},
};

/** id da automação criada pelo `setup` (o fluxo precisa pertencer a ela para ser salvo/ligado a uma versão). */
let docId = "f";
function flow(seconds = 1): WorkflowDocument {
  const d = createEmptyWorkflow(docId, "Teste");
  d.nodes.push({
    id: "w",
    type: "flow.wait",
    version: 1,
    config: { ...defaultConfig(getNodeDefinition("flow.wait")!), seconds },
  });
  d.nodes.push({ id: "end", type: "flow.end", version: 1, config: {} });
  d.edges.push({
    id: "e1",
    source: "start",
    sourceHandle: "next",
    target: "w",
    targetHandle: "input",
  });
  d.edges.push({
    id: "e2",
    source: "w",
    sourceHandle: "next",
    target: "end",
    targetHandle: "input",
  });
  return d;
}

/** Motor falso: cada ação fica pendente até o teste resolvê-la, ou é cancelada por engine.cancel. */
function fakeEngine(status: EngineStatus = READY) {
  const pending: Array<{
    req: ActionRequest;
    resolve: (o: ActionOutcome) => void;
    onProgress?: (p: ActionProgress) => void;
  }> = [];
  const engine: EngineLike & { status: EngineStatus } = {
    status,
    executeAction: (req, onProgress) =>
      new Promise((resolve) => pending.push({ req, resolve, onProgress })),
    cancel: vi.fn((executionId: string) => {
      for (const p of pending.splice(0))
        if (p.req.executionId === executionId) p.resolve({ kind: "cancelled" });
    }),
  };
  return { engine, pending };
}
const setup = (
  status?: EngineStatus,
  extra: Partial<Parameters<typeof createExecutionManager>[0]> = {},
  logCap = 5000,
) => {
  let seq = 0;
  const f = fakeEngine(status);
  const events: ExecutionEvent[] = [];
  const db = openDatabase(":memory:");
  const automations = createAutomationService(db);
  const workflows = createWorkflowService(db);
  const history = createHistoryService(db, { maxLogsPerExecution: logCap });
  const automationId = automations.create({ name: "Teste", description: "" }).id;
  docId = automationId;
  const mgr = createExecutionManager({
    engine: f.engine,
    emit: (e) => events.push(e),
    newId: () => `exec-${++seq}`,
    history,
    workflows,
    ...extra,
  });
  const start = (doc: unknown, options?: Parameters<typeof mgr.start>[2]) =>
    mgr.start(automationId, doc, options);
  return { ...f, events, mgr, start, history, workflows, automationId, db };
};
const tick = () => new Promise((r) => setTimeout(r, 10));
const finished = (events: ExecutionEvent[]) =>
  events.find((e) => e.type === "execution_finished");
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
    const { mgr, start, pending, events } = setup();
    expect(start(flow())).toEqual({ executionId: "exec-1" });
    await tick();
    expect(mgr.isRunning()).toBe(true);
    expect(pending[0]!.req).toMatchObject({
      executionId: "exec-1",
      nodeId: "w",
      action: "flow.wait",
      config: { seconds: 1 },
    });
    pending[0]!.onProgress?.({ percent: 50 });
    pending[0]!.resolve({ kind: "completed", outputs: {} });
    await tick();
    expect(finished(events)).toMatchObject({ status: "completed" });
    expect(events.some((e) => e.type === "node_progress")).toBe(true);
    expect(mgr.isRunning()).toBe(false);
    expect(code(() => start(flow()))).toBe("NO_ERROR"); // pode iniciar outra
  });

  it("recusa quando o motor não está pronto, explicando o motivo", () => {
    for (const status of [
      { state: "starting" },
      { state: "restarting" },
      { state: "unavailable", reason: "Python não encontrado" },
    ] as EngineStatus[]) {
      const { start } = setup(status);
      expect(code(() => start(flow()))).toBe("ENGINE_UNAVAILABLE");
    }
    const { start } = setup({
      state: "unavailable",
      reason: "Python não encontrado",
    });
    expect(() => start(flow())).toThrow(/Python não encontrado/);
  });

  it("recusa documento malformado e fluxo com erros de validação, sem tocar o motor", () => {
    const { mgr, start, pending } = setup();
    expect(code(() => start({ lixo: true }))).toBe("VALIDATION");
    const bad = flow();
    bad.nodes.find((n) => n.id === "w")!.config = { seconds: -5 };
    expect(() => start(bad)).toThrow(/1 erro e não pode ser executado/);
    expect(pending).toHaveLength(0);
    expect(mgr.isRunning()).toBe(false);
  });

  it("só uma execução por vez", async () => {
    const { start } = setup();
    start(flow());
    await tick();
    expect(code(() => start(flow()))).toBe("EXECUTION_BUSY");
  });

  it("cancelar propaga ao motor e termina como cancelado", async () => {
    const { mgr, start, events, engine } = setup();
    start(flow());
    await tick();
    mgr.cancel("exec-1");
    await tick();
    expect(engine.cancel).toHaveBeenCalledWith("exec-1");
    expect(finished(events)).toMatchObject({ status: "cancelled" });
    expect(mgr.isRunning()).toBe(false);
  });

  it("cancelar id desconhecido ou depois do fim → NOT_FOUND", async () => {
    const { mgr, start, pending } = setup();
    expect(code(() => mgr.cancel("x"))).toBe("NOT_FOUND");
    start(flow());
    await tick();
    pending[0]!.resolve({ kind: "completed", outputs: {} });
    await tick();
    expect(code(() => mgr.cancel("exec-1"))).toBe("NOT_FOUND");
  });

  it("falha do motor no meio vira falha da execução, não exceção", async () => {
    const { mgr, start, pending, events } = setup();
    start(flow());
    await tick();
    pending[0]!.resolve({
      kind: "failed",
      error: {
        code: "ENGINE_CRASHED",
        message: "O motor de automação encerrou inesperadamente.",
      },
    });
    await tick();
    expect(finished(events)).toMatchObject({
      status: "failed",
      error: { code: "ENGINE_CRASHED" },
    });
    expect(mgr.isRunning()).toBe(false);
  });

  it("timeout global cancela a ação no motor", async () => {
    const { start, events, engine } = setup();
    const d = flow();
    d.settings.timeoutSeconds = 1;
    start(d);
    await new Promise((r) => setTimeout(r, 1200));
    expect(engine.cancel).toHaveBeenCalledWith("exec-1");
    expect(finished(events)).toMatchObject({
      status: "failed",
      error: { code: "TIMEOUT" },
    });
  });

  it("listener de evento que lança não quebra a execução", async () => {
    const f = setup(undefined, {
      emit: () => {
        throw new Error("renderer morreu");
      },
    });
    const { mgr, start } = f;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    start(flow());
    await tick();
    f.pending[0]!.resolve({ kind: "completed", outputs: {} });
    await tick();
    expect(mgr.isRunning()).toBe(false);
  });

  it("shutdown cancela a execução em curso", async () => {
    const { mgr, start, events } = setup();
    start(flow());
    await tick();
    await mgr.shutdown();
    expect(finished(events)).toMatchObject({ status: "cancelled" });
  });

  it("grava no histórico: início, nós, fim, versão salva e fluxo executado", async () => {
    const { mgr, start, pending, history, automationId, workflows } = setup();
    const doc = flow();
    workflows.save(automationId, doc);
    start(doc);
    await tick();
    expect(history.get("exec-1").summary).toMatchObject({
      status: "running",
      versionNumber: 1,
      mode: "run",
    });
    pending[0]!.resolve({ kind: "completed", outputs: {} });
    await tick();
    const d = history.get("exec-1");
    expect(d.summary).toMatchObject({
      status: "completed",
      durationMs: expect.any(Number),
    });
    expect(d.document.nodes.map((n) => n.id)).toContain("w");
    expect(d.logs.map((l) => l.message).join("|")).toMatch(
      /iniciada.*Esperar.*concluído.*concluída/s,
    );
    expect(mgr.isRunning()).toBe(false);
  });

  it("rascunho diferente da versão salva não se liga a nenhuma versão", async () => {
    const { start, history, automationId, workflows } = setup();
    workflows.save(automationId, flow(1));
    start(flow(2));
    await tick();
    expect(history.get("exec-1").summary.versionNumber).toBeNull();
  });

  it("falha grava erro, nó culpado e causa", async () => {
    const { start, pending, history } = setup();
    start(flow());
    await tick();
    pending[0]!.resolve({
      kind: "failed",
      error: { code: "X", message: "deu ruim" },
    });
    await tick();
    const d = history.get("exec-1");
    expect(d.summary).toMatchObject({
      status: "failed",
      errorNodeId: "w",
      errorMessage: expect.stringContaining("deu ruim"),
    });
    expect(d.logs.some((l) => l.level === "error" && l.nodeId === "w")).toBe(
      true,
    );
  });

  it("automação inexistente → NOT_FOUND e nada é gravado", () => {
    const { mgr, history } = setup();
    expect(code(() => mgr.start("nao-existe", flow()))).toBe("NOT_FOUND");
    expect(history.list().total).toBe(0);
  });

  it("passo a passo: começa pausado, segue um nó por vez; pausa e retomada ficam no histórico", async () => {
    const { mgr, start, pending, events, history } = setup();
    start(flow(), { mode: "step" });
    await tick();
    expect(pending).toHaveLength(0);
    expect(events.find((e) => e.type === "execution_paused")).toMatchObject({
      reason: "start",
    });
    expect(history.get("exec-1").summary.status).toBe("paused");
    mgr.step("exec-1");
    await tick();
    expect(history.get("exec-1").summary.status).toBe("paused"); // pausou de novo antes do próximo nó
    mgr.resume("exec-1");
    await tick();
    expect(pending).toHaveLength(1);
    expect(history.get("exec-1").summary.status).toBe("running");
    pending[0]!.resolve({ kind: "completed", outputs: {} });
    await tick();
    expect(history.get("exec-1").summary.status).toBe("completed");
  });

  it("breakpoint pausa antes do nó e setBreakpoints vale durante a execução", async () => {
    const { mgr, start, pending, events } = setup();
    start(flow(), { breakpoints: ["w"] });
    await tick();
    expect(pending).toHaveLength(0);
    expect(events.find((e) => e.type === "execution_paused")).toMatchObject({
      nodeId: "w",
      reason: "breakpoint",
    });
    mgr.setBreakpoints("exec-1", []);
    mgr.resume("exec-1");
    await tick();
    expect(pending).toHaveLength(1);
  });

  it("cancelar uma execução pausada termina como cancelada", async () => {
    const { mgr, start, events, history } = setup();
    start(flow(), { mode: "step" });
    await tick();
    mgr.cancel("exec-1");
    await tick();
    expect(finished(events)).toMatchObject({ status: "cancelled" });
    expect(history.get("exec-1").summary.status).toBe("cancelled");
  });

  it("executar a partir de um nó; nó inexistente é recusado", async () => {
    const { start, pending, events, mgr } = setup();
    expect(code(() => start(flow(), { fromNodeId: "nada" }))).toBe(
      "VALIDATION",
    );
    expect(code(() => start(flow(), { mode: "from" }))).toBe("VALIDATION");
    start(flow(), { fromNodeId: "w" });
    await tick();
    expect(pending[0]!.req.nodeId).toBe("w");
    expect(events.find((e) => e.type === "execution_started")).toMatchObject({
      mode: "from",
      startNodeId: "w",
    });
    mgr.cancel("exec-1");
  });

  it("controles em id desconhecido → NOT_FOUND", () => {
    const { mgr } = setup();
    for (const fn of [mgr.pause, mgr.resume, mgr.step])
      expect(code(() => fn("x"))).toBe("NOT_FOUND");
    expect(code(() => mgr.setBreakpoints("x", []))).toBe("NOT_FOUND");
  });

  it("diagnóstico só é capturado quando ligado e o caminho vai para o log do nó que falhou", async () => {
    for (const enabled of [false, true]) {
      const capture = vi.fn(async () => "/diag/x.png");
      const { start, pending, history } = setup(undefined, {
        captureDiagnostic: capture,
        captureEnabled: () => enabled,
      });
      start(flow());
      await tick();
      pending[0]!.resolve({
        kind: "failed",
        error: { code: "X", message: "falhou" },
      });
      await tick();
      expect(capture).toHaveBeenCalledTimes(enabled ? 1 : 0);
      expect(
        history.get("exec-1").logs.filter((l) => l.hasDiagnostic),
      ).toHaveLength(enabled ? 1 : 0);
      expect(history.get("exec-1").summary.status).toBe("failed");
    }
  });

  it("laço longo: o histórico respeita o teto de logs, avisa o que omitiu e a execução termina normalmente", async () => {
    const { start, history, automationId } = setup(undefined, {}, 20);
    const d = createEmptyWorkflow(automationId, "Laço");
    d.variables["x"] = { type: "number", value: 0 };
    d.nodes.push({ id: "r", type: "flow.repeat", version: 1, config: { times: 500 } });
    d.nodes.push({ id: "s", type: "data.set_variable", version: 1, config: { name: "x", value: "1" } });
    d.nodes.push({ id: "end", type: "flow.end", version: 1, config: {} });
    d.edges.push({ id: "e1", source: "start", sourceHandle: "next", target: "r", targetHandle: "input" });
    d.edges.push({ id: "e2", source: "r", sourceHandle: "body", target: "s", targetHandle: "input" });
    d.edges.push({ id: "e3", source: "s", sourceHandle: "next", target: "r", targetHandle: "input" });
    d.edges.push({ id: "e4", source: "r", sourceHandle: "done", target: "end", targetHandle: "input" });
    start(d);
    await new Promise((r) => setTimeout(r, 300));
    const detail = history.get("exec-1");
    expect(detail.summary.status).toBe("completed");
    expect(detail.logs.length).toBeLessThanOrEqual(21);
    expect(detail.logs.at(-1)?.message).toMatch(/omitidos/);
  });

  it("disparada por agendamento: modo 'scheduled', log da origem e onFinished só DEPOIS de o histórico gravar o fim", async () => {
    const seen: { id: string; status: string; historyStatus: string }[] = [];
    let get: () => string = () => "";
    const { mgr, pending, history, automationId } = setup(undefined, {
      onFinished: (id, status) => seen.push({ id, status, historyStatus: get() }),
    });
    get = () => history.get("exec-1").summary.status;
    mgr.start(automationId, flow(), {}, { scheduleId: "sch-1" });
    await tick();
    pending[0]!.resolve({ kind: "completed", outputs: {} });
    await tick();
    expect(history.get("exec-1").summary.mode).toBe("scheduled");
    expect(history.get("exec-1").logs[0]!.message).toBe("Execução iniciada pelo agendamento.");
    expect(seen).toEqual([{ id: "exec-1", status: "completed", historyStatus: "completed" }]);
  });

  it("shutdown só resolve depois de o fim estar gravado (o banco pode fechar em seguida)", async () => {
    const { mgr, start, history } = setup();
    start(flow());
    await tick();
    await mgr.shutdown();
    expect(history.get("exec-1").summary.status).toBe("cancelled");
  });

  it("avisa o motor do fim da execução (ele fecha o navegador etc.), uma vez por execução, sucesso ou falha", async () => {
    const f = fakeEngine(); // o dublê do motor ganha o gancho depois de criado
    const calls: string[] = [];
    f.engine.endExecution = (id) => calls.push(id);
    const db = openDatabase(":memory:");
    const automations = createAutomationService(db);
    const wf = createWorkflowService(db);
    const a = automations.create({ name: "x", description: "" });
    docId = a.id;
    const mgr = createExecutionManager({ engine: f.engine, emit: () => undefined, newId: () => "ex-end", history: createHistoryService(db), workflows: wf });
    mgr.start(a.id, flow());
    await tick();
    f.pending[0]!.resolve({ kind: "failed", error: { code: "X", message: "falhou" } });
    await tick();
    expect(calls).toEqual(["ex-end"]);
  });

  it("Chamar fluxo: roda a versão SALVA do outro fluxo, grava no histórico os nós internos com nome legível e devolve o retorno", async () => {
    const f = fakeEngine();
    const db = openDatabase(":memory:");
    const automations = createAutomationService(db);
    const wf = createWorkflowService(db);
    const history = createHistoryService(db);
    const sub = automations.create({ name: "Rotina interna", description: "" });
    const subDoc = createEmptyWorkflow(sub.id, "Rotina interna");
    subDoc.variables["saida"] = { type: "string", value: "padrão" };
    subDoc.nodes.push({ id: "w", type: "flow.wait", version: 1, config: { seconds: 0 } }, { id: "end", type: "flow.end", version: 1, config: {} });
    subDoc.edges.push({ id: "e1", source: "start", sourceHandle: "next", target: "w", targetHandle: "input" }, { id: "e2", source: "w", sourceHandle: "next", target: "end", targetHandle: "input" });
    wf.save(sub.id, subDoc);
    const main = automations.create({ name: "Principal", description: "" });
    const mainDoc = createEmptyWorkflow(main.id, "Principal");
    mainDoc.variables["r"] = { type: "string", value: "" };
    mainDoc.nodes.push(
      { id: "chama", type: "flow.subflow", version: 1, config: { automationId: sub.id, "arg.saida": "olá" } },
      { id: "guarda", type: "data.set_variable", version: 1, config: { name: "r", value: "{{nodes.chama.outputs.saida}}" } },
      { id: "end", type: "flow.end", version: 1, config: {} },
    );
    mainDoc.edges.push(
      { id: "e1", source: "start", sourceHandle: "next", target: "chama", targetHandle: "input" },
      { id: "e2", source: "chama", sourceHandle: "success", target: "guarda", targetHandle: "input" },
      { id: "e3", source: "guarda", sourceHandle: "next", target: "end", targetHandle: "input" },
    );
    wf.save(main.id, mainDoc);
    // rascunho do fluxo chamado NÃO conta: só a versão salva roda (aqui o salvo é o único)
    const mgr = createExecutionManager({ engine: f.engine, emit: () => undefined, newId: () => "ex-sub", history, workflows: wf });
    mgr.start(main.id, mainDoc);
    await tick();
    expect(f.pending[0]!.req).toMatchObject({ action: "flow.wait", nodeId: "w" }); // a ação do fluxo chamado chegou ao motor
    f.pending[0]!.resolve({ kind: "completed", outputs: {} });
    await tick();
    const d = history.get("ex-sub");
    expect(d.summary.status).toBe("completed");
    expect(d.snapshot?.variables["r"]).toBe("olá");
    const text = d.logs.map((l) => l.message).join("\n");
    expect(text).toContain("Rotina interna › Esperar: concluído");
    expect(text).toContain("Chamar fluxo: concluído — Fluxo “Rotina interna” concluído.");

    // arquivar o fluxo chamado: a próxima chamada falha apontando o nó e o motivo (e nada roda)
    automations.setArchived(sub.id, true);
    const mgr2 = createExecutionManager({ engine: f.engine, emit: () => undefined, newId: () => "ex-sub2", history, workflows: wf });
    mgr2.start(main.id, mainDoc);
    await tick();
    const d2 = history.get("ex-sub2");
    expect(d2.summary).toMatchObject({ status: "failed", errorNodeId: "chama" });
    expect(d2.summary.errorMessage).toContain("arquivado");
  });
});
