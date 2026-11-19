import { describe, expect, it } from "vitest";
import { defaultConfig, getNodeDefinition } from "@automation-studio/node-registry";
import type { ActionOutcome, ActionRequest, ExecutionEvent } from "@automation-studio/shared-types";
import { createEmptyWorkflow, type ConfigValue, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { RunControl, runWorkflow, isContinuable, type ActionExecutor } from "./index.js";

let doc: WorkflowDocument;
const node = (id: string, type: string, config: Record<string, ConfigValue> = {}) =>
  doc.nodes.push({ id, type, version: 1, config: { ...defaultConfig(getNodeDefinition(type)!), ...config } });
const edge = (source: string, handle: string, target: string) =>
  doc.edges.push({ id: `${source}.${handle}>${target}`, source, sourceHandle: handle, target, targetHandle: "input" });
/** start → a → b → c → end (esperas) */
const chain = () => {
  doc = createEmptyWorkflow("f", "Cadeia");
  for (const id of ["a", "b", "c"]) node(id, "flow.wait", { seconds: 0 });
  node("end", "flow.end", { message: "fim" });
  edge("start", "next", "a"); edge("a", "next", "b"); edge("b", "next", "c"); edge("c", "next", "end");
};

type Script = (req: ActionRequest) => ActionOutcome | Promise<ActionOutcome>;
const ok: Script = () => ({ kind: "completed", outputs: {} });
type Over = Partial<Parameters<typeof runWorkflow>[1]>;
function start(script: Script = ok, over: Over = {}) {
  const events: ExecutionEvent[] = [];
  const calls: ActionRequest[] = [];
  const executor: ActionExecutor = { execute: async (req) => (calls.push(req), script(req)) };
  const result = runWorkflow(doc, { executionId: "x", executor, onEvent: (e) => events.push(e), ...over });
  return { events, calls, result };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Espera um evento (sem dormir às cegas). */
async function until(events: ExecutionEvent[], pred: (e: ExecutionEvent) => boolean, ms = 2000): Promise<ExecutionEvent> {
  const end = Date.now() + ms;
  for (;;) {
    const e = events.find(pred);
    if (e) return e;
    if (Date.now() > end) throw new Error(`evento não chegou; recebidos: ${events.map((x) => x.type).join(", ")}`);
    await sleep(2);
  }
}
const nth = (events: ExecutionEvent[], type: string) => events.filter((e) => e.type === type);
const started = (events: ExecutionEvent[]) => events.filter((e) => e.type === "node_started").map((e) => (e as { nodeId: string }).nodeId);

describe("breakpoints", () => {
  it("pausa ANTES do nó, mostra o contexto e continua ao retomar", async () => {
    chain();
    doc.variables = { pasta: { type: "string", value: "C:\\x" } };
    const control = new RunControl({ breakpoints: ["b"] });
    const { events, calls, result } = start(ok, { control });
    const paused = (await until(events, (e) => e.type === "execution_paused")) as Extract<ExecutionEvent, { type: "execution_paused" }>;
    expect(paused).toMatchObject({ nodeId: "b", label: "Esperar", reason: "breakpoint" });
    expect(paused.snapshot.variables).toEqual({ pasta: "C:\\x" });
    expect(started(events)).toEqual(["start", "a"]); // b ainda NÃO começou
    expect(calls.map((c) => c.nodeId)).toEqual(["a"]);
    expect(control.paused).toBe(true);
    control.resume();
    expect((await result).status).toBe("completed");
    expect(started(events)).toEqual(["start", "a", "b", "c", "end"]);
    expect(nth(events, "execution_resumed")).toHaveLength(1);
    expect(nth(events, "execution_paused")).toHaveLength(1);
  });

  it("dentro de um laço pausa a cada volta", async () => {
    doc = createEmptyWorkflow("f", "L");
    node("r", "flow.repeat", { times: 3 });
    node("w", "flow.wait", { seconds: 0 });
    node("end", "flow.end");
    edge("start", "next", "r"); edge("r", "body", "w"); edge("w", "next", "r"); edge("r", "done", "end");
    const control = new RunControl({ breakpoints: ["w"] });
    const { events, result } = start(ok, { control });
    for (let i = 1; i <= 3; i++) {
      await until(events, () => nth(events, "execution_paused").length === i);
      control.resume();
    }
    expect((await result).status).toBe("completed");
    expect(nth(events, "execution_paused")).toHaveLength(3);
  });

  it("breakpoints podem ser trocados com a execução pausada", async () => {
    chain();
    const control = new RunControl({ breakpoints: ["a"] });
    const { events, result } = start(ok, { control });
    await until(events, (e) => e.type === "execution_paused");
    control.setBreakpoints(["c"]); // tira o de 'a', põe em 'c'
    control.resume();
    await until(events, () => nth(events, "execution_paused").length === 2);
    expect((nth(events, "execution_paused")[1] as { nodeId: string }).nodeId).toBe("c");
    control.resume();
    expect((await result).status).toBe("completed");
  });

  it("breakpoint num nó que nunca roda não pausa nada", async () => {
    chain();
    node("fora", "flow.wait", { seconds: 0 });
    const control = new RunControl({ breakpoints: ["fora"] });
    const { events, result } = start(ok, { control });
    expect((await result).status).toBe("completed");
    expect(nth(events, "execution_paused")).toHaveLength(0);
  });
});

describe("passo a passo", () => {
  it("pausa antes de cada nó; 'passo' executa exatamente um e pausa de novo", async () => {
    chain();
    const control = new RunControl({ startPaused: true });
    const { events, calls, result } = start(ok, { control, mode: "step" });
    const paused = () => nth(events, "execution_paused") as Extract<ExecutionEvent, { type: "execution_paused" }>[];
    await until(events, () => paused().length === 1);
    expect(paused()[0]).toMatchObject({ nodeId: "start", reason: "start" });
    expect(started(events)).toEqual([]); // nada rodou ainda

    const order = ["start", "a", "b", "c", "end"];
    for (let i = 0; i < order.length - 1; i++) {
      control.step();
      await until(events, () => paused().length === i + 2);
      expect(paused()[i + 1]).toMatchObject({ nodeId: order[i + 1], reason: "step" });
      expect(started(events)).toEqual(order.slice(0, i + 1)); // um nó por passo
    }
    expect(calls.map((c) => c.nodeId)).toEqual(["a", "b", "c"]);
    control.resume(); // solta o resto
    expect((await result).status).toBe("completed");
    expect(started(events)).toEqual(order);
  });

  it("'continuar' no meio do passo a passo vai até o fim sem novas pausas", async () => {
    chain();
    const control = new RunControl({ startPaused: true });
    const { events, result } = start(ok, { control });
    await until(events, (e) => e.type === "execution_paused");
    control.step();
    await until(events, () => nth(events, "execution_paused").length === 2);
    control.resume();
    expect((await result).status).toBe("completed");
    expect(nth(events, "execution_paused")).toHaveLength(2);
  });
});

describe("pausar durante a execução (cooperativo)", () => {
  it("o pedido é avisado na hora, mas a pausa só ocorre quando a ação em andamento termina", async () => {
    chain();
    const control = new RunControl();
    let finishA!: () => void;
    const { events, calls, result } = start((req) => (req.nodeId === "a" ? new Promise<ActionOutcome>((r) => (finishA = () => r({ kind: "completed", outputs: {} }))) : { kind: "completed", outputs: {} }), { control });
    await until(events, () => calls.length === 1); // 'a' está rodando
    control.requestPause();
    const req = (await until(events, (e) => e.type === "execution_pause_requested")) as { nodeId: string };
    expect(req.nodeId).toBe("a"); // a interface pode dizer "pausando… aguardando o fim de 'a'"
    expect(nth(events, "execution_paused")).toHaveLength(0); // ainda não pausou
    finishA();
    const paused = (await until(events, (e) => e.type === "execution_paused")) as { nodeId: string; reason: string };
    expect(paused).toMatchObject({ nodeId: "b", reason: "user" }); // pausa antes do PRÓXIMO nó
    expect(started(events)).toEqual(["start", "a"]);
    control.resume();
    expect((await result).status).toBe("completed");
  });

  it("retomar antes de a pausa acontecer cancela o pedido", async () => {
    chain();
    const control = new RunControl();
    let finishA!: () => void;
    const { events, calls, result } = start((req) => (req.nodeId === "a" ? new Promise<ActionOutcome>((r) => (finishA = () => r({ kind: "completed", outputs: {} }))) : { kind: "completed", outputs: {} }), { control });
    await until(events, () => calls.length === 1);
    control.requestPause();
    control.resume(); // desistiu
    finishA();
    expect((await result).status).toBe("completed");
    expect(nth(events, "execution_paused")).toHaveLength(0);
  });

  it("pedir pausa quando já está pausado não faz nada", async () => {
    chain();
    const control = new RunControl({ breakpoints: ["a"] });
    const { events, result } = start(ok, { control });
    await until(events, (e) => e.type === "execution_paused");
    control.requestPause();
    expect(nth(events, "execution_pause_requested")).toHaveLength(0);
    control.resume();
    await result;
  });
});

describe("cancelar e timeout com pausa", () => {
  it("cancelar enquanto pausado encerra como cancelado, sem executar o que falta", async () => {
    chain();
    const ctl = new AbortController();
    const control = new RunControl({ breakpoints: ["b"] });
    const { events, calls, result } = start(ok, { control, signal: ctl.signal });
    await until(events, (e) => e.type === "execution_paused");
    ctl.abort();
    expect((await result).status).toBe("cancelled");
    expect(calls.map((c) => c.nodeId)).toEqual(["a"]);
    expect(nth(events, "execution_resumed")).toHaveLength(0);
  });

  it("o tempo parado NÃO conta para o timeout", async () => {
    chain();
    const control = new RunControl({ startPaused: true });
    const { events, result } = start(ok, { control, timeoutMs: 150 });
    await until(events, (e) => e.type === "execution_paused");
    await sleep(400); // bem mais que o timeout de 150 ms
    control.resume();
    expect((await result).status).toBe("completed");
  });

  it("fora da pausa o timeout continua valendo", async () => {
    chain();
    const control = new RunControl();
    const slow: Script = (req) => new Promise<ActionOutcome>((r) => setTimeout(() => r({ kind: "completed", outputs: {} }), req.nodeId === "b" ? 600 : 0));
    const { result } = start(slow, { control, timeoutMs: 150 });
    expect(await result).toMatchObject({ status: "failed", error: { code: "TIMEOUT" } });
  });
});

describe("executar a partir de um nó", () => {
  it("pula o que vem antes e aplica as variáveis iniciais com o tipo declarado", async () => {
    chain();
    doc.variables = { n: { type: "number", value: 1 } };
    doc.nodes.find((x) => x.id === "b")!.config = { seconds: "{{variables.n}}" };
    const { events, calls, result } = start(ok, { startAt: "b", variables: { n: "7" } });
    expect((await result).status).toBe("completed");
    expect(started(events)).toEqual(["b", "c", "end"]); // 'start' e 'a' não rodaram
    expect(calls[0]!.config["seconds"]).toBe(7); // "7" virou número (tipo declarado)
    expect(events[0]).toMatchObject({ type: "execution_started", mode: "from", startNodeId: "b" });
  });

  it("valor inicial incompatível com o tipo falha antes de executar", async () => {
    chain();
    doc.variables = { n: { type: "number", value: 1 } };
    const { calls, result } = start(ok, { startAt: "b", variables: { n: "abc" } });
    expect(await result).toMatchObject({ status: "failed", error: { code: "INVALID_CONFIG", message: expect.stringContaining("Valor inicial inválido") } });
    expect(calls).toHaveLength(0);
  });

  it("nó inexistente", async () => {
    chain();
    expect(await start(ok, { startAt: "fantasma" }).result).toMatchObject({ status: "failed", error: { code: "INVALID_WORKFLOW" } });
  });

  it("nó que depende do resultado de um nó que não rodou: erro claro (o contexto não existe)", async () => {
    doc = createEmptyWorkflow("f", "R");
    node("list", "files.list", { path: "C:\\x" });
    node("t", "input.type_text", { text: "{{nodes.list.count}}" });
    edge("start", "next", "list"); edge("list", "success", "t");
    const r = await start(ok, { startAt: "t" }).result;
    expect(r).toMatchObject({ status: "failed", error: { message: expect.stringContaining("ainda não foi executado") } });
  });
});

describe("política de erro: continuar", () => {
  const fail: Script = (req) => (req.nodeId === "b" ? { kind: "failed", error: { code: "PERMISSION_DENIED", message: "sem permissão" } } : { kind: "completed", outputs: {} });

  it("o nó que falha é ignorado: o fluxo segue e termina 'com avisos'", async () => {
    chain();
    doc.settings.errorPolicy = "continue";
    const { events, result } = start(fail);
    const r = await result;
    expect(r.status).toBe("completed_with_warnings");
    expect(started(events)).toEqual(["start", "a", "b", "c", "end"]); // c e end rodaram
    expect(events.find((e) => e.type === "node_failed")).toMatchObject({ nodeId: "b", handled: "continued" });
    expect(events.at(-1)).toMatchObject({ type: "execution_finished", status: "completed_with_warnings", warnings: 1, message: expect.stringContaining("1 nó(s) falharam e foram ignorados") });
  });

  it("política 'parar' (padrão) continua parando, e aponta o nó", async () => {
    chain();
    const { events, result } = start(fail);
    expect(await result).toMatchObject({ status: "failed", error: { code: "PERMISSION_DENIED", message: "Esperar: sem permissão" } });
    expect(started(events)).toEqual(["start", "a", "b"]);
    expect(events.at(-1)).toMatchObject({ failedNodeId: "b" });
    expect(events.find((e) => e.type === "node_failed")).not.toHaveProperty("handled");
  });

  it("dentro de um 'Para cada item': uma falha não impede os outros itens", async () => {
    doc = createEmptyWorkflow("f", "E");
    doc.settings.errorPolicy = "continue";
    node("list", "files.list", { path: "C:\\x" });
    node("each", "flow.foreach", { items: "{{nodes.list.files}}", itemName: "item" });
    node("mv", "files.move", { source: "{{item}}", destination: "C:\\o" });
    node("end", "flow.end");
    edge("start", "next", "list"); edge("list", "success", "each"); edge("each", "body", "mv"); edge("mv", "success", "each"); edge("each", "done", "end");
    const { calls, result } = start((req) => req.action === "files.list" ? { kind: "completed", outputs: { files: ["a", "b", "c"] } } : req.config["source"] === "b" ? { kind: "failed", error: { code: "DESTINATION_EXISTS", message: "já existe" } } : { kind: "completed", outputs: {} });
    const r = await result;
    expect(r.status).toBe("completed_with_warnings");
    expect(calls.filter((c) => c.action === "files.move").map((c) => c.config["source"])).toEqual(["a", "b", "c"]); // os três foram tentados
  });

  it("nunca ignora erro de infraestrutura nem de configuração", async () => {
    for (const code of ["ENGINE_CRASHED", "INVALID_CONFIG", "INTERNAL_ERROR", "TIMEOUT", "ENGINE_UNAVAILABLE", "LOOP_LIMIT"]) {
      chain();
      doc.settings.errorPolicy = "continue";
      const r = await start((req) => (req.nodeId === "b" ? { kind: "failed", error: { code, message: "x" } } : { kind: "completed", outputs: {} })).result;
      expect(r.status, code).toBe("failed");
      expect(isContinuable(code)).toBe(false);
    }
    expect(isContinuable("PATH_NOT_FOUND") && isContinuable("WINDOW_NOT_FOUND")).toBe(true);
  });

  it("saída 'Erro' ligada tem prioridade: tratado, sem aviso", async () => {
    doc = createEmptyWorkflow("f", "H");
    doc.settings.errorPolicy = "continue";
    node("l", "files.list", { path: "C:\\x" });
    node("ok", "flow.end", { message: "ok" });
    node("tratado", "flow.end", { message: "tratado" });
    edge("start", "next", "l"); edge("l", "success", "ok"); edge("l", "error", "tratado");
    const { events, result } = start(() => ({ kind: "failed", error: { code: "PATH_NOT_FOUND", message: "x" } }));
    expect((await result).status).toBe("completed"); // sem "com avisos": o fluxo previu o erro
    expect(events.find((e) => e.type === "node_failed")).toMatchObject({ handled: "error_branch" });
  });

  it("nó sem saída normal (Se/Senão) não pode continuar: para mesmo na política 'continuar'", async () => {
    doc = createEmptyWorkflow("f", "C");
    doc.settings.errorPolicy = "continue";
    node("c", "flow.condition", { left: "banana", operator: "greater", right: "1" }); // comparação inválida
    node("sim", "flow.end"); node("nao", "flow.end");
    edge("start", "next", "c"); edge("c", "true", "sim"); edge("c", "false", "nao");
    expect(await start().result).toMatchObject({ status: "failed" });
  });

  it("falha no último nó (sem próxima ligação) também termina 'com avisos'", async () => {
    doc = createEmptyWorkflow("f", "U");
    doc.settings.errorPolicy = "continue";
    node("a", "flow.wait", { seconds: 0 });
    edge("start", "next", "a");
    const r = await start(() => ({ kind: "failed", error: { code: "X", message: "y" } })).result;
    expect(r.status).toBe("completed_with_warnings");
  });
});

describe("visualização do contexto (variáveis e resultados)", () => {
  it("o resumo da pausa mostra variáveis, resultados de nós e o item do laço, sem despejar listas inteiras", async () => {
    doc = createEmptyWorkflow("f", "S");
    doc.variables = { destino: { type: "string", value: "C:\\out" } };
    node("list", "files.list", { path: "C:\\in" });
    node("each", "flow.foreach", { items: "{{nodes.list.files}}", itemName: "arquivo" });
    node("mv", "files.move", { source: "{{arquivo.path}}", destination: "{{variables.destino}}" });
    node("end", "flow.end");
    edge("start", "next", "list"); edge("list", "success", "each"); edge("each", "body", "mv"); edge("mv", "success", "each"); edge("each", "done", "end");
    const files = Array.from({ length: 50 }, (_, i) => ({ name: `f${i}`, path: `C:\\in\\f${i}`, extra: "x".repeat(500) }));
    const control = new RunControl({ breakpoints: ["mv"] });
    const { events, result } = start((req) => (req.action === "files.list" ? { kind: "completed", outputs: { count: 50, files } } : { kind: "completed", outputs: {} }), { control });
    const p = (await until(events, (e) => e.type === "execution_paused")) as Extract<ExecutionEvent, { type: "execution_paused" }>;
    expect(p.snapshot.variables).toEqual({ destino: "C:\\out" });
    expect(p.snapshot.loops).toEqual([{ name: "arquivo", index: 1, count: 50, item: { type: "object", fields: { name: "f0", path: "C:\\in\\f0", extra: `${"x".repeat(200)}…` } } }]);
    const list = p.snapshot.results.find((r) => r.nodeId === "list")!;
    expect(list.label).toBe("Listar arquivos");
    expect(list.outputs["count"]).toBe(50);
    expect(list.outputs["files"]).toMatchObject({ type: "list", count: 50 });
    expect((list.outputs["files"] as { items: unknown[] }).items).toHaveLength(5); // só os 5 primeiros
    expect(JSON.stringify(p.snapshot).length).toBeLessThan(5000); // não despeja os 50 itens de 500 caracteres
    control.setBreakpoints([]);
    control.resume();
    await result;
  });

  it("o fim da execução também traz o contexto final (para investigar uma falha)", async () => {
    chain();
    doc.variables = { v: { type: "number", value: 3 } };
    const r = start((req) => (req.nodeId === "b" ? { kind: "failed", error: { code: "X", message: "y" } } : { kind: "completed", outputs: { feito: req.nodeId } }));
    await r.result;
    const fin = r.events.at(-1) as Extract<ExecutionEvent, { type: "execution_finished" }>;
    expect(fin.snapshot?.variables).toEqual({ v: 3 });
    expect(fin.snapshot?.results.map((x) => x.nodeId)).toEqual(["start", "a"]); // o que rodou antes da falha
  });
});
