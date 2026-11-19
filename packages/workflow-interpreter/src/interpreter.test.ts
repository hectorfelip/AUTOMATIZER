import { describe, expect, it } from "vitest";
import { defaultConfig, getNodeDefinition } from "@automation-studio/node-registry";
import type { ActionOutcome, ActionRequest, ExecutionEvent } from "@automation-studio/shared-types";
import { createEmptyWorkflow, type ConfigValue, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { resolveConfig, runWorkflow, type ActionExecutor, type ResolveContext } from "./index.js";

let doc: WorkflowDocument;
const ctxOf = (variables: ResolveContext["variables"] = {}, extra: Partial<ResolveContext> = {}): ResolveContext => ({ variables, nodes: new Map(), labels: new Map(), loops: [], ...extra });
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
    expect(resolveConfig({ a: "{{variables.x}}" }, ctxOf())).toEqual({ ok: false, message: "“a”: A variável “x” não está definida." });
    const bad = resolveConfig({ a: "{{ process.exit(1) }}" }, ctxOf());
    expect(bad.ok).toBe(false);
    expect(resolveConfig({ a: 1, b: true, c: null, d: "texto" }, ctxOf())).toEqual({ ok: true, config: { a: 1, b: true, c: null, d: "texto" } });
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

// ---------- nós de controle (executados pelo interpretador, nunca pelo motor) ----------
describe("Definir variável", () => {
  it("o valor definido é visto pelos nós seguintes", async () => {
    doc = createEmptyWorkflow("f", "V");
    node("sv", "data.set_variable", { name: "pasta", value: "C:\\Backup" });
    node("l", "files.list", { path: "{{variables.pasta}}" });
    node("end", "flow.end");
    edge("start", "next", "sv");
    edge("sv", "next", "l");
    edge("l", "success", "end");
    const { calls, events, result } = run(ok);
    expect((await result).status).toBe("completed");
    expect(calls).toHaveLength(1); // só o listar foi ao motor
    expect(calls[0]!.config["path"]).toBe("C:\\Backup");
    expect(events.find((e) => e.type === "node_completed" && e.nodeId === "sv")).toMatchObject({ message: "Variável “pasta” = C:\\Backup." });
  });

  it("respeita o tipo declarado: texto numérico vira número", async () => {
    doc = createEmptyWorkflow("f", "V");
    doc.variables = { n: { type: "number", value: 0 } };
    node("sv", "data.set_variable", { name: "n", value: "5" });
    node("w2", "flow.wait", { seconds: "{{variables.n}}" });
    edge("start", "next", "sv");
    edge("sv", "next", "w2");
    const { calls, result } = run(ok);
    await result;
    expect(calls[0]!.config["seconds"]).toBe(5);
  });

  it("referência pura copia o valor com o tipo original", async () => {
    doc = createEmptyWorkflow("f", "V");
    doc.variables = { origem: { type: "number", value: 7 }, destino: { type: "number", value: 0 } };
    node("sv", "data.set_variable", { name: "destino", value: "{{variables.origem}}" });
    node("w2", "flow.wait", { seconds: "{{variables.destino}}" });
    edge("start", "next", "sv");
    edge("sv", "next", "w2");
    const { calls, result } = run(ok);
    await result;
    expect(calls[0]!.config["seconds"]).toBe(7);
  });

  it("valor incompatível com o tipo declarado falha no nó, com mensagem clara", async () => {
    doc = createEmptyWorkflow("f", "V");
    doc.variables = { n: { type: "number", value: 0 } };
    node("sv", "data.set_variable", { name: "n", value: "abc" });
    edge("start", "next", "sv");
    const { calls, result } = run(ok);
    const r = await result;
    expect(r).toMatchObject({ status: "failed", error: { code: "INVALID_CONFIG", message: expect.stringContaining("não é numérico") } });
    expect(calls).toHaveLength(0);
  });

  it("não altera o documento (a variável é do contexto da execução)", async () => {
    doc = createEmptyWorkflow("f", "V");
    doc.variables = { n: { type: "number", value: 1 } };
    node("sv", "data.set_variable", { name: "n", value: "9" });
    edge("start", "next", "sv");
    const before = JSON.stringify(doc);
    await run(ok).result;
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("Se / Senão", () => {
  const branches = (left: string, operator: string, right: string) => {
    doc = createEmptyWorkflow("f", "C");
    node("c", "flow.condition", { left, operator, right });
    node("yes", "flow.end", { message: "sim" });
    node("no", "flow.end", { message: "nao" });
    edge("start", "next", "c");
    edge("c", "true", "yes");
    edge("c", "false", "no");
    return run(ok);
  };
  const outcome = async (r: ReturnType<typeof branches>) => {
    await r.result;
    return (r.events.at(-1) as { message?: string }).message;
  };

  it("segue o caminho verdadeiro ou falso sem consultar o motor", async () => {
    const t = branches("5", "equals", "5");
    expect(await outcome(t)).toBe("sim");
    expect(t.calls).toHaveLength(0);
    expect(await outcome(branches("5", "equals", "6"))).toBe("nao");
  });
  it("compara números como números ('10' maior que '9')", async () => {
    expect(await outcome(branches("10", "greater", "9"))).toBe("sim");
  });
  it("usa variáveis", async () => {
    doc = createEmptyWorkflow("f", "C");
    doc.variables = { ext: { type: "string", value: "pdf" } };
    node("c", "flow.condition", { left: "{{variables.ext}}", operator: "equals", right: "pdf" });
    node("yes", "flow.end", { message: "sim" });
    edge("start", "next", "c");
    edge("c", "true", "yes");
    expect(await outcome(run(ok))).toBe("sim");
  });
  it("comparação inválida falha o nó em vez de adivinhar", async () => {
    const r = branches("banana", "greater", "10");
    expect(await r.result).toMatchObject({ status: "failed", error: { code: "INVALID_CONFIG" } });
  });
  it("o evento explica a decisão", async () => {
    const r = branches("a.pdf", "contains", ".pdf");
    await r.result;
    expect(r.events.find((e) => e.type === "node_completed" && e.nodeId === "c")).toMatchObject({ port: "true", message: "“a.pdf” contém “.pdf”: verdadeiro." });
  });
});

describe("Repetir N vezes", () => {
  /** start → r ─body→ w ─→ r (volta);  r ─done→ end */
  const loop = (times: ConfigValue, wired = true) => {
    doc = createEmptyWorkflow("f", "R");
    node("r", "flow.repeat", { times });
    node("w", "flow.wait", { seconds: 0 });
    node("end", "flow.end", { message: "fim" });
    edge("start", "next", "r");
    edge("r", "body", "w");
    if (wired) edge("w", "next", "r");
    edge("r", "done", "end");
  };

  it("executa o corpo N vezes e depois segue por 'Depois'", async () => {
    loop(3);
    const { calls, events, result } = run(ok);
    expect((await result).status).toBe("completed");
    expect(calls).toHaveLength(3);
    expect(events.filter((e) => e.type === "node_started" && e.nodeId === "r")).toHaveLength(4); // 3 voltas + a saída
    expect((events.at(-1) as { message?: string }).message).toBe("fim");
    const msgs = events.filter((e) => e.type === "node_completed" && e.nodeId === "r").map((e) => (e as { message?: string }).message);
    expect(msgs).toEqual(["Repetição 1 de 3.", "Repetição 2 de 3.", "Repetição 3 de 3.", "3 repetição(ões) concluída(s)."]);
  });

  it("o número de vezes pode vir de uma variável", async () => {
    loop("{{variables.n}}");
    doc.variables = { n: { type: "number", value: 2 } };
    const { calls, result } = run(ok);
    await result;
    expect(calls).toHaveLength(2);
  });

  it.each([[0], [1.5], [100_001]])("valor inválido em tempo de execução (%s) falha o nó", async (n) => {
    loop("{{variables.n}}");
    doc.variables = { n: { type: "number", value: n } };
    expect(await run(ok).result).toMatchObject({ status: "failed", error: { code: "INVALID_CONFIG" } });
  });

  it("laços aninhados: o contador interno zera a cada passagem (2 × 3 = 6)", async () => {
    doc = createEmptyWorkflow("f", "R");
    node("outer", "flow.repeat", { times: 2 });
    node("inner", "flow.repeat", { times: 3 });
    node("w", "flow.wait", { seconds: 0 });
    node("end", "flow.end");
    edge("start", "next", "outer");
    edge("outer", "body", "inner");
    edge("inner", "body", "w");
    edge("w", "next", "inner");
    edge("inner", "done", "outer"); // terminou o interno: volta ao externo
    edge("outer", "done", "end");
    const { calls, result } = run(ok);
    expect((await result).status).toBe("completed");
    expect(calls).toHaveLength(6);
  });

  it("sem ligar o corpo de volta, o fluxo termina após uma passagem (comportamento documentado)", async () => {
    loop(5, false);
    const { calls, result } = run(ok);
    expect((await result).status).toBe("completed");
    expect(calls).toHaveLength(1);
  });

  it("milhares de voltas não estouram o limite de passos", async () => {
    loop(5000);
    const { calls, result } = run(ok);
    expect((await result).status).toBe("completed");
    expect(calls).toHaveLength(5000);
  });

  it("cancelar no meio do laço interrompe as repetições", async () => {
    loop(1000);
    const ctl = new AbortController();
    let n = 0;
    const { calls, result } = run(() => (++n === 3 && ctl.abort(), { kind: "completed", outputs: {} }), { signal: ctl.signal });
    expect((await result).status).toBe("cancelled");
    expect(calls).toHaveLength(3);
  });

  it("falha dentro do laço interrompe a execução e aponta o nó", async () => {
    loop(5);
    let n = 0;
    const r = await run(() => (++n === 2 ? { kind: "failed", error: { code: "X", message: "quebrou" } } : { kind: "completed", outputs: {} })).result;
    expect(r).toMatchObject({ status: "failed", error: { message: "Esperar: quebrou" } });
  });
});


// ---------- resultados de nós e "Para cada item" ----------
const file = (name: string, folder = "C:\\in") => {
  const dot = name.lastIndexOf(".");
  return { name, stem: dot < 0 ? name : name.slice(0, dot), extension: dot < 0 ? "" : name.slice(dot + 1), path: `${folder}\\${name}`, folder, size: 1, modifiedAt: "2026-01-01T00:00:00" };
};
/** Executor que devolve `files` para files.list e sucesso para o resto. */
const listing = (files: unknown): Script => (req) =>
  req.action === "files.list" ? { kind: "completed", outputs: { count: Array.isArray(files) ? files.length : 0, files, folder: "C:\\in", truncated: false } } : { kind: "completed", outputs: {} };

describe("resultado dos nós: {{nodes.<id>.<resultado>}}", () => {
  /** start → list → (condição por count) */
  const countFlow = () => {
    doc = createEmptyWorkflow("f", "R");
    node("list", "files.list", { path: "C:\\in" });
    node("c", "flow.condition", { left: "{{nodes.list.count}}", operator: "greater", right: "0" });
    node("sim", "flow.end", { message: "tem" });
    node("nao", "flow.end", { message: "vazio" });
    edge("start", "next", "list"); edge("list", "success", "c"); edge("c", "true", "sim"); edge("c", "false", "nao");
  };
  const last = async (r: ReturnType<typeof run>) => (await r.result, (r.events.at(-1) as { message?: string }).message);

  it("decide com a quantidade devolvida por um nó anterior", async () => {
    countFlow();
    expect(await last(run(listing([file("a.pdf"), file("b.pdf")])))).toBe("tem");
    expect(await last(run(listing([])))).toBe("vazio");
  });

  it("número continua número: 'Repetir' usa a quantidade como nº de voltas", async () => {
    doc = createEmptyWorkflow("f", "R");
    node("list", "files.list", { path: "C:\\in" });
    node("r", "flow.repeat", { times: "{{nodes.list.count}}" });
    node("w", "flow.wait", { seconds: 0 });
    node("end", "flow.end");
    edge("start", "next", "list"); edge("list", "success", "r"); edge("r", "body", "w"); edge("w", "next", "r"); edge("r", "done", "end");
    const { calls, result } = run(listing([file("a"), file("b"), file("c")]));
    expect((await result).status).toBe("completed");
    expect(calls.filter((c) => c.action === "flow.wait")).toHaveLength(3);
  });

  it("interpola em texto e acessa uma posição da lista", async () => {
    doc = createEmptyWorkflow("f", "R");
    node("list", "files.list", { path: "C:\\in" });
    node("t", "input.type_text", { text: "achei {{nodes.list.count}}; o primeiro é {{nodes.list.files.0.name}}" });
    edge("start", "next", "list"); edge("list", "success", "t");
    const { calls, result } = run(listing([file("relatorio.pdf"), file("b.txt")]));
    await result;
    expect(calls[1]!.config["text"]).toBe("achei 2; o primeiro é relatorio.pdf");
  });

  it("nó que ainda não rodou: erro claro em tempo de execução (a ordem só gera aviso no desenho)", async () => {
    doc = createEmptyWorkflow("f", "R");
    node("t", "input.type_text", { text: "{{nodes.list.count}}" });
    node("list", "files.list", { path: "C:\\in" });
    edge("start", "next", "t"); edge("t", "success", "list");
    const r = await run(ok).result;
    expect(r).toMatchObject({ status: "failed", error: { code: "INVALID_CONFIG", message: expect.stringContaining("Listar arquivos” ainda não foi executado") } });
  });

  it("lista e objeto em campo de texto explicam o que fazer, em vez de virar '[object Object]'", () => {
    const ctx = ctxOf({}, { nodes: new Map([["l", { files: [file("a")], meta: { x: 1 } }]]), labels: new Map([["l", "Listar arquivos"]]) });
    expect(resolveConfig({ t: "{{nodes.l.files}}" }, ctx, { t: "text" })).toMatchObject({ ok: false, message: expect.stringContaining("é uma lista; percorra-a com “Para cada item”") });
    expect(resolveConfig({ t: "{{nodes.l.files.0}}" }, ctx, { t: "text" })).toMatchObject({ ok: false, message: expect.stringContaining("é um objeto") });
    expect(resolveConfig({ t: "x {{nodes.l.meta}} y" }, ctx, { t: "text" })).toMatchObject({ ok: false });
  });

  it("caminhos seguros: só propriedades próprias e posições; nunca length, métodos nem protótipo", () => {
    const ctx = ctxOf({}, { nodes: new Map([["l", { files: [file("a")], nome: "abc" }]]), loops: [{ nodeId: "e", name: "item", item: file("a"), index: 1, count: 1 }] });
    for (const bad of ["{{nodes.l.files.length}}", "{{nodes.l.files.1}}", "{{nodes.l.nome.length}}", "{{item.toString}}", "{{item.hasOwnProperty}}", "{{item.inexistente}}", "{{nodes.l.files.0.nmae}}"]) {
      expect(resolveConfig({ t: bad }, ctx, { t: "text" }), bad).toMatchObject({ ok: false });
    }
    // e o que a sintaxe nem deixa passar:
    for (const bad of ["{{item.constructor}}", "{{item.__proto__}}", "{{nodes.l.files.0.constructor}}", "{{item.constructor.constructor('return process')()}}"]) {
      expect(resolveConfig({ t: bad }, ctx, { t: "text" }), bad).toMatchObject({ ok: false });
    }
    expect(resolveConfig({ t: "{{item.name}}" }, ctx, { t: "text" })).toEqual({ ok: true, config: { t: "a" } });
  });

  it("propriedade que só existe no PROTÓTIPO do item não vaza (distingue hasOwn de 'in')", () => {
    const item = Object.create({ segredo: "vazou", nome: "herdado" }) as Record<string, unknown>;
    item["publica"] = "ok";
    const ctx = ctxOf({}, { loops: [{ nodeId: "e", name: "item", item, index: 1, count: 1 }] });
    expect(resolveConfig({ t: "{{item.publica}}" }, ctx, { t: "text" })).toEqual({ ok: true, config: { t: "ok" } });
    for (const leaked of ["{{item.segredo}}", "{{item.nome}}"]) {
      const r = resolveConfig({ t: leaked }, ctx, { t: "text" });
      expect(r, leaked).toMatchObject({ ok: false, message: expect.stringContaining("não existe") });
    }
  });

  it("Definir variável não aceita lista nem objeto", async () => {
    doc = createEmptyWorkflow("f", "R");
    node("list", "files.list", { path: "C:\\in" });
    node("sv", "data.set_variable", { name: "x", value: "{{nodes.list.files}}" });
    edge("start", "next", "list"); edge("list", "success", "sv");
    const r = await run(listing([file("a")])).result;
    expect(r).toMatchObject({ status: "failed" }); // o validador já recusa (NOT_A_LIST); se passasse, o interpretador também recusaria
  });
});

describe("Para cada item", () => {
  /** start → list → each ─body→ mv ─→ each ;  each ─done→ end */
  const eachFlow = (itemName = "item", items = "{{nodes.list.files}}") => {
    doc = createEmptyWorkflow("f", "E");
    node("list", "files.list", { path: "C:\\in" });
    node("each", "flow.foreach", { items, itemName });
    node("mv", "files.move", { source: `{{${itemName}.path}}`, destination: `C:\\out\\{{${itemName}.extension}}` });
    node("end", "flow.end", { message: "fim" });
    edge("start", "next", "list"); edge("list", "success", "each"); edge("each", "body", "mv"); edge("mv", "success", "each"); edge("each", "done", "end");
  };

  it("executa o corpo uma vez por item, com as propriedades de cada um", async () => {
    eachFlow();
    const files = [file("a.pdf"), file("b.txt"), file("c.pdf")];
    const { calls, events, result } = run(listing(files));
    expect((await result).status).toBe("completed");
    const moves = calls.filter((c) => c.action === "files.move");
    expect(moves.map((c) => c.config)).toEqual([
      { source: "C:\\in\\a.pdf", destination: "C:\\out\\pdf", overwrite: false },
      { source: "C:\\in\\b.txt", destination: "C:\\out\\txt", overwrite: false },
      { source: "C:\\in\\c.pdf", destination: "C:\\out\\pdf", overwrite: false },
    ]);
    const msgs = events.filter((e) => e.type === "node_completed" && e.nodeId === "each").map((e) => (e as { message?: string }).message);
    expect(msgs).toEqual(["Item 1 de 3.", "Item 2 de 3.", "Item 3 de 3.", "3 item(ns) processado(s)."]);
    expect((events.at(-1) as { message?: string }).message).toBe("fim");
  });

  it("posição e total ficam disponíveis como resultado do laço", async () => {
    eachFlow();
    doc.nodes.find((n) => n.id === "mv")!.config = { source: "{{item.path}}", destination: "C:\\out\\{{nodes.each.index}}-de-{{nodes.each.count}}" };
    const { calls, result } = run(listing([file("a"), file("b")]));
    await result;
    expect(calls.filter((c) => c.action === "files.move").map((c) => c.config["destination"])).toEqual(["C:\\out\\1-de-2", "C:\\out\\2-de-2"]);
  });

  it("lista vazia: o corpo nunca roda e o fluxo segue por 'Depois'", async () => {
    eachFlow();
    const { calls, events, result } = run(listing([]));
    expect((await result).status).toBe("completed");
    expect(calls.filter((c) => c.action === "files.move")).toHaveLength(0);
    expect(events.find((e) => e.type === "node_completed" && e.nodeId === "each")).toMatchObject({ port: "done", message: "A lista está vazia; nada a repetir." });
  });

  it("itens que são texto ou número (não objetos): {{item}} inteiro", async () => {
    doc = createEmptyWorkflow("f", "E");
    node("list", "files.list", { path: "C:\\in" });
    node("each", "flow.foreach", { items: "{{nodes.list.files}}", itemName: "nome" });
    node("t", "input.type_text", { text: "oi {{nome}}" });
    node("w", "flow.wait", { seconds: "{{nome}}" });
    node("end", "flow.end");
    edge("start", "next", "list"); edge("list", "success", "each"); edge("each", "body", "t"); edge("t", "success", "w"); edge("w", "next", "each"); edge("each", "done", "end");
    const { calls, result } = run(listing([1, 2]));
    expect((await result).status).toBe("completed");
    expect(calls.filter((c) => c.action === "input.type_text").map((c) => c.config["text"])).toEqual(["oi 1", "oi 2"]);
    expect(calls.filter((c) => c.action === "flow.wait").map((c) => c.config["seconds"])).toEqual([1, 2]); // número continua número
  });

  it("laços aninhados com nomes diferentes: 2 pastas × 3 arquivos = 6 passagens, cada uma com seus dois itens", async () => {
    doc = createEmptyWorkflow("f", "E");
    node("l1", "files.list", { path: "C:\\a" });
    node("fora", "flow.foreach", { items: "{{nodes.l1.files}}", itemName: "pasta" });
    node("l2", "files.list", { path: "{{pasta.path}}" });
    node("dentro", "flow.foreach", { items: "{{nodes.l2.files}}", itemName: "arq" });
    node("t", "input.type_text", { text: "{{pasta.name}}/{{arq.name}}" });
    node("end", "flow.end");
    edge("start", "next", "l1"); edge("l1", "success", "fora"); edge("fora", "body", "l2"); edge("l2", "success", "dentro");
    edge("dentro", "body", "t"); edge("t", "success", "dentro"); edge("dentro", "done", "fora"); edge("fora", "done", "end");
    const { calls, result } = run((req) => {
      if (req.action !== "files.list") return { kind: "completed", outputs: {} };
      const root = req.config["path"] === "C:\\a";
      return { kind: "completed", outputs: { count: 0, files: root ? [file("P1", "C:\\a"), file("P2", "C:\\a")] : [file("x"), file("y"), file("z")] } };
    });
    expect((await result).status).toBe("completed");
    expect(calls.filter((c) => c.action === "input.type_text").map((c) => c.config["text"])).toEqual(["P1/x", "P1/y", "P1/z", "P2/x", "P2/y", "P2/z"]);
  });

  it("mesmo nome em laços aninhados: o de dentro vale enquanto roda e o de fora volta depois", async () => {
    doc = createEmptyWorkflow("f", "E");
    node("l1", "files.list", { path: "C:\\a" });
    node("fora", "flow.foreach", { items: "{{nodes.l1.files}}", itemName: "item" });
    node("l2", "files.list", { path: "C:\\b" });
    node("dentro", "flow.foreach", { items: "{{nodes.l2.files}}", itemName: "item" });
    node("t", "input.type_text", { text: "dentro={{item.name}}" });
    node("apos", "input.type_text", { text: "fora={{item.name}}" });
    node("end", "flow.end");
    edge("start", "next", "l1"); edge("l1", "success", "fora"); edge("fora", "body", "l2"); edge("l2", "success", "dentro");
    edge("dentro", "body", "t"); edge("t", "success", "dentro"); edge("dentro", "done", "apos"); edge("apos", "success", "fora"); edge("fora", "done", "end");
    const { calls, result } = run((req) => req.action !== "files.list" ? { kind: "completed", outputs: {} } : { kind: "completed", outputs: { count: 0, files: req.config["path"] === "C:\\a" ? [file("A1"), file("A2")] : [file("b1")] } });
    await result;
    expect(calls.filter((c) => c.action === "input.type_text").map((c) => c.config["text"])).toEqual(["dentro=b1", "fora=A1", "dentro=b1", "fora=A2"]);
  });

  it("a lista é lida uma vez; mudar o resultado do nó no meio não altera o laço", async () => {
    eachFlow();
    let listings = 0;
    const { calls, result } = run((req) => {
      if (req.action === "files.list") return { kind: "completed", outputs: { count: 2, files: [file("a"), file("b")] }, ...(listings++, {}) };
      return { kind: "completed", outputs: {} };
    });
    await result;
    expect(listings).toBe(1);
    expect(calls.filter((c) => c.action === "files.move")).toHaveLength(2);
  });

  it("o resultado não é uma lista: falha com mensagem clara", async () => {
    eachFlow();
    const { result } = run(listing("não sou uma lista"));
    expect(await result).toMatchObject({ status: "failed", error: { code: "INVALID_CONFIG", message: expect.stringContaining("não é uma lista") } });
  });

  it("falha dentro do corpo interrompe e aponta o nó; cancelar interrompe o laço", async () => {
    eachFlow();
    let n = 0;
    const failing = run((req) => req.action === "files.list" ? { kind: "completed", outputs: { files: [file("a"), file("b"), file("c")] } } : ++n === 2 ? { kind: "failed", error: { code: "X", message: "sem permissão" } } : { kind: "completed", outputs: {} });
    expect(await failing.result).toMatchObject({ status: "failed", error: { message: "Mover arquivo: sem permissão" } });
    expect(failing.calls.filter((c) => c.action === "files.move")).toHaveLength(2); // parou no segundo

    eachFlow();
    const ctl = new AbortController();
    let m = 0;
    const cancelled = run((req) => req.action === "files.list" ? { kind: "completed", outputs: { files: Array.from({ length: 50 }, (_, i) => file(`f${i}`)) } } : (++m === 3 && ctl.abort(), { kind: "completed", outputs: {} }), { signal: ctl.signal });
    expect((await cancelled.result).status).toBe("cancelled");
    expect(cancelled.calls.filter((c) => c.action === "files.move")).toHaveLength(3);
  });

  it("execuções simultâneas do mesmo fluxo não misturam itens", async () => {
    eachFlow();
    const slow = (names: string[]): Script => async (req) => {
      await sleep(5);
      return req.action === "files.list" ? { kind: "completed", outputs: { files: names.map((n) => file(n)) } } : { kind: "completed", outputs: {} };
    };
    const a = run(slow(["a1", "a2", "a3"]), { executionId: "A" });
    const b = run(slow(["b1", "b2"]), { executionId: "B" });
    await Promise.all([a.result, b.result]);
    expect(a.calls.filter((c) => c.action === "files.move").map((c) => c.config["source"])).toEqual(["C:\\in\\a1", "C:\\in\\a2", "C:\\in\\a3"]);
    expect(b.calls.filter((c) => c.action === "files.move").map((c) => c.config["source"])).toEqual(["C:\\in\\b1", "C:\\in\\b2"]);
  });

  it("listas grandes (2000 itens) percorrem sem estourar o limite de passos", async () => {
    eachFlow();
    const { calls, result } = run(listing(Array.from({ length: 2000 }, (_, i) => file(`f${i}.txt`))));
    expect((await result).status).toBe("completed");
    expect(calls.filter((c) => c.action === "files.move")).toHaveLength(2000);
  });
});
