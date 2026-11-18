import { describe, expect, it } from "vitest";
import { defaultConfig, getNodeDefinition } from "@automation-studio/node-registry";
import type { ActionOutcome, ActionRequest, ExecutionEvent } from "@automation-studio/shared-types";
import { createEmptyWorkflow, type ConfigValue, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { resolveConfig, runWorkflow, type ActionExecutor } from "./index.js";

let doc: WorkflowDocument;
const node = (id: string, type: string, config: Record<string, ConfigValue> = {}) =>
  doc.nodes.push({ id, type, version: 1, config: { ...defaultConfig(getNodeDefinition(type)!), ...config } });
const edge = (source: string, handle: string, target: string) =>
  doc.edges.push({ id: `${source}.${handle}>${target}`, source, sourceHandle: handle, target, targetHandle: "input" });
/** start → w (esperar) → end */
const simple = () => {
  doc = createEmptyWorkflow("f", "Fluxo");
  node("w", "flow.wait", { seconds: 2 });
  node("end", "flow.end", { message: "Pronto" });
  edge("start", "next", "w");
  edge("w", "next", "end");
};

type Script = (req: ActionRequest, ctl: Parameters<ActionExecutor["execute"]>[1]) => ActionOutcome | Promise<ActionOutcome>;
const run = (script: Script, over: Partial<Parameters<typeof runWorkflow>[1]> = {}) => {
  const events: ExecutionEvent[] = [];
  const calls: ActionRequest[] = [];
  const executor: ActionExecutor = { execute: async (req, ctl) => (calls.push(req), script(req, ctl)) };
  const result = runWorkflow(doc, { executionId: "ex1", executor, onEvent: (e) => events.push(e), ...over });
  return { events, calls, result };
};
const ok: Script = () => ({ kind: "completed", outputs: {} });
const types = (e: ExecutionEvent[]) => e.map((x) => x.type + ("nodeId" in x ? `:${x.nodeId}` : ""));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const abortable = (ms: number): Script => (_r, { signal }) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve({ kind: "completed", outputs: {} }), ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve({ kind: "cancelled" })));
  });

describe("fluxo feliz", () => {
  it("executa início → ação → fim e emite os eventos na ordem", async () => {
    simple();
    const { events, calls, result } = run(ok);
    expect(await result).toMatchObject({ status: "completed" });
    expect(types(events)).toEqual([
      "execution_started", "node_started:start", "node_completed:start",
      "node_started:w", "node_completed:w", "node_started:end", "node_completed:end", "execution_finished",
    ]);
    expect(calls).toEqual([{ executionId: "ex1", nodeId: "w", action: "flow.wait", config: { seconds: 2 } }]); // início e fim não vão ao motor
    const last = events.at(-1)!;
    expect(last).toMatchObject({ type: "execution_finished", status: "completed", message: "Pronto" });
    expect(events.every((e) => e.executionId === "ex1")).toBe(true);
  });

  it("encaminha progresso como node_progress", async () => {
    simple();
    const { events, result } = run((_r, { onProgress }) => (onProgress({ percent: 50, message: "metade" }), { kind: "completed", outputs: {} }));
    await result;
    expect(events.find((e) => e.type === "node_progress")).toMatchObject({ nodeId: "w", percent: 50, message: "metade" });
  });

  it("fim implícito: saída sem conexão encerra como concluído", async () => {
    simple();
    doc.edges = doc.edges.filter((e) => e.target !== "end");
    expect(await run(ok).result).toMatchObject({ status: "completed" });
  });

  it("usa o relógio injetado e mede a duração", async () => {
    simple();
    let t = 1_000;
    const now = () => new Date((t += 10));
    const r = await run(ok, { now }).result;
    expect(r.durationMs).toBeGreaterThan(0);
  });
});

describe("variáveis", () => {
  it("resolve referências antes de enviar ao motor, mantendo o tipo quando é só a referência", async () => {
    simple();
    doc.variables = { pasta: { type: "string", value: "C:\\Downloads" }, n: { type: "number", value: 7 } };
    node("l", "files.list", { path: "{{variables.pasta}}\\novos", pattern: "{{ variables.n }}" });
    node("w2", "flow.wait", { seconds: "{{variables.n}}" });
    doc.edges = [];
    edge("start", "next", "l");
    edge("l", "success", "w2");
    edge("w2", "next", "end");
    const { calls, result } = run(ok);
    expect(await result).toMatchObject({ status: "completed" });
    expect(calls[0]!.config).toMatchObject({ path: "C:\\Downloads\\novos", pattern: "7" });
    expect(calls[1]!.config["seconds"]).toBe(7); // número continua número
  });

  it("ajusta ao tipo do campo: texto fica texto, número aceita variável de texto numérica", async () => {
    simple();
    doc.variables = { s: { type: "string", value: "5" }, n: { type: "number", value: 7 } };
    node("l", "files.list", { path: "{{variables.n}}" }); // campo de texto recebendo número
    node("w2", "flow.wait", { seconds: "{{variables.s}}" }); // campo numérico recebendo texto "5"
    doc.edges = [];
    edge("start", "next", "l");
    edge("l", "success", "w2");
    edge("w2", "next", "end");
    const { calls, result } = run(ok);
    await result;
    expect(calls[0]!.config["path"]).toBe("7");
    expect(calls[1]!.config["seconds"]).toBe(5);
  });

  it("resolveConfig: variável inexistente e expressão não suportada são erros, nada é avaliado", () => {
    expect(resolveConfig({ a: "{{variables.x}}" }, {})).toEqual({ ok: false, message: "“a” usa a variável “x”, que não está definida." });
    const bad = resolveConfig({ a: "{{ process.exit(1) }}" }, {});
    expect(bad.ok).toBe(false);
    expect(resolveConfig({ a: 1, b: true, c: null, d: "texto" }, {})).toEqual({ ok: true, config: { a: 1, b: true, c: null, d: "texto" } });
  });

  it("cada execução tem seu contexto: o documento não é alterado e execuções simultâneas não se misturam", async () => {
    simple();
    doc.variables = { v: { type: "number", value: 1 } };
    doc.nodes.find((n) => n.id === "w")!.config = { seconds: "{{variables.v}}" };
    const before = JSON.stringify(doc);
    const a = run(async (r) => (await sleep(20), { kind: "completed", outputs: { got: r.config["seconds"] } }), { executionId: "A" });
    const b = run(async (r) => (await sleep(5), { kind: "completed", outputs: { got: r.config["seconds"] } }), { executionId: "B" });
    await Promise.all([a.result, b.result]);
    expect(JSON.stringify(doc)).toBe(before);
    expect(a.events.every((e) => e.executionId === "A") && b.events.every((e) => e.executionId === "B")).toBe(true);
  });
});

describe("falhas", () => {
  const fail: Script = () => ({ kind: "failed", error: { code: "BOOM", message: "deu ruim" } });

  it("falha sem caminho de erro interrompe e aponta nó e causa", async () => {
    simple();
    const { events, result } = run(fail);
    const r = await result;
    expect(r).toMatchObject({ status: "failed", error: { code: "BOOM", message: "Esperar: deu ruim" } });
    expect(events.some((e) => e.type === "node_failed" && e.nodeId === "w")).toBe(true);
    expect(types(events)).not.toContain("node_started:end");
  });

  it("falha com saída 'error' conectada segue o caminho de erro e conclui", async () => {
    doc = createEmptyWorkflow("f", "F");
    node("l", "files.list", { path: "C:\\x" });
    node("ok", "flow.end", { message: "sucesso" });
    node("bad", "flow.end", { message: "tratado" });
    edge("start", "next", "l");
    edge("l", "success", "ok");
    edge("l", "error", "bad");
    const r = await run(fail).result;
    expect(r.status).toBe("completed");
  });

  it("executor que lança exceção vira INTERNAL_ERROR sem derrubar o interpretador", async () => {
    simple();
    const r = await run(() => {
      throw new Error("kaboom");
    }).result;
    expect(r).toMatchObject({ status: "failed", error: { code: "INTERNAL_ERROR" } });
  });

  it("saída indicada pela ação que o nó não tem é erro, não ignorada", async () => {
    simple();
    const r = await run(() => ({ kind: "completed", outputs: {}, next: "inexistente" })).result;
    expect(r).toMatchObject({ status: "failed", error: { code: "INVALID_ACTION_RESULT" } });
  });

  it("fluxo inválido nunca chega ao motor", async () => {
    simple();
    node("mv", "files.move"); // sem origem/destino
    edge("w", "success", "mv");
    const { calls, events, result } = run(ok);
    const r = await result;
    expect(calls).toHaveLength(0);
    expect(r).toMatchObject({ status: "failed", error: { code: "INVALID_WORKFLOW" } });
    expect(r.error?.message).toMatch(/erro.*não pode ser executado/);
    expect(types(events)).toEqual(["execution_started", "execution_finished"]);
  });

  it("loop sem saída é interrompido pelo limite de passos", async () => {
    doc = createEmptyWorkflow("f", "Loop");
    node("a", "flow.wait", { seconds: 0 });
    node("b", "flow.wait", { seconds: 0 });
    edge("start", "next", "a");
    edge("a", "next", "b");
    edge("b", "next", "a"); // ciclo sem decisão: o validador só avisa; a execução é quem protege
    const r = await run(ok, { maxSteps: 50 }).result;
    expect(r).toMatchObject({ status: "failed", error: { code: "LOOP_LIMIT" } });
  });
});

describe("decisões", () => {
  it("o resultado da ação escolhe a saída (Verificar existência: verdadeiro/falso)", async () => {
    for (const [next, expected] of [["true", "yes"], ["false", "no"]] as const) {
      doc = createEmptyWorkflow("f", "D");
      node("ex", "files.exists", { path: "C:\\x" });
      node("yes", "flow.end", { message: "yes" });
      node("no", "flow.end", { message: "no" });
      edge("start", "next", "ex");
      edge("ex", "true", "yes");
      edge("ex", "false", "no");
      const { events, result } = run(() => ({ kind: "completed", outputs: {}, next }));
      await result;
      expect(events.at(-1)).toMatchObject({ message: expected });
    }
  });
});

describe("cancelamento e timeout", () => {
  it("cancelar durante uma ação encerra como cancelado e não executa mais nada", async () => {
    simple();
    const ctl = new AbortController();
    const { events, calls, result } = run(abortable(5000), { signal: ctl.signal });
    await sleep(30);
    ctl.abort();
    const r = await result;
    expect(r.status).toBe("cancelled");
    expect(calls).toHaveLength(1);
    expect(types(events)).not.toContain("node_started:end");
    expect(events.at(-1)).toMatchObject({ type: "execution_finished", status: "cancelled" });
  });

  it("já cancelado antes de começar: nada é executado", async () => {
    simple();
    const { calls, result } = run(ok, { signal: AbortSignal.abort() });
    expect((await result).status).toBe("cancelled");
    expect(calls).toHaveLength(0);
  });

  it("cancelar logo depois que a ação terminou também cancela (sem seguir adiante)", async () => {
    simple();
    const ctl = new AbortController();
    const { calls, result } = run(() => (ctl.abort(), { kind: "completed", outputs: {} }), { signal: ctl.signal });
    expect((await result).status).toBe("cancelled");
    expect(calls).toHaveLength(1);
  });

  it("timeout global interrompe a ação em curso e falha com TIMEOUT", async () => {
    simple();
    doc.settings.timeoutSeconds = 1;
    const { result } = run(abortable(10_000));
    const t0 = Date.now();
    const r = await result;
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(r).toMatchObject({ status: "failed", error: { code: "TIMEOUT", message: expect.stringContaining("1 s") } });
  });

  it("cancelar tem prioridade de mensagem sobre o timeout: é 'cancelado', não 'falhou'", async () => {
    simple();
    const ctl = new AbortController();
    const { result } = run(abortable(5000), { signal: ctl.signal });
    ctl.abort();
    expect((await result).status).toBe("cancelled");
  });
});
