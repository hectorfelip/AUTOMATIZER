import { describe, expect, it } from "vitest";
import { defaultConfig, getNodeDefinition } from "@automation-studio/node-registry";
import type { ActionOutcome, ActionRequest, ExecutionEvent } from "@automation-studio/shared-types";
import { createEmptyWorkflow, type ConfigValue, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { MAX_SUBFLOW_DEPTH, RunControl, runWorkflow, type ActionExecutor, type SubflowLookup } from "./index.js";

const add = (doc: WorkflowDocument, id: string, type: string, config: Record<string, ConfigValue> = {}) =>
  doc.nodes.push({ id, type, version: 1, config: { ...defaultConfig(getNodeDefinition(type)!), ...config } });
const link = (doc: WorkflowDocument, s: string, h: string, t: string) => doc.edges.push({ id: `${s}.${h}>${t}`, source: s, sourceHandle: h, target: t, targetHandle: "input" });

/** start → nós em sequência (cada um com a porta indicada) → end */
function flow(id: string, name: string, nodes: [string, string, Record<string, ConfigValue>, string?][], vars: WorkflowDocument["variables"] = {}) {
  const d = createEmptyWorkflow(id, name);
  d.variables = vars;
  let prev = "start";
  let port = "next";
  for (const [nid, type, cfg, outPort] of nodes) {
    add(d, nid, type, cfg);
    link(d, prev, port, nid);
    prev = nid;
    port = outPort ?? (getNodeDefinition(type)!.outputs.some((o) => o.id === "success") ? "success" : "next");
  }
  add(d, "end", "flow.end", {});
  link(d, prev, port, "end");
  return d;
}

const library = new Map<string, WorkflowDocument>();
const provider = {
  load: (id: string): SubflowLookup => {
    const doc = library.get(id);
    return doc ? { ok: true, doc, name: doc.name } : { ok: false, code: "SUBFLOW_NOT_FOUND", message: "Fluxo chamado não encontrado." };
  },
};
type Script = (req: ActionRequest, signal: AbortSignal) => ActionOutcome | Promise<ActionOutcome>;
/** Como o motor real: fica pendente até cancelarem (o `signal` aborta). */
const hang: Script = (_r, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) resolve({ kind: "cancelled" });
    else signal.addEventListener("abort", () => resolve({ kind: "cancelled" }), { once: true });
  });
const okScript: Script = () => ({ kind: "completed", outputs: {} });
function run(doc: WorkflowDocument, script: Script = okScript, over: Partial<Parameters<typeof runWorkflow>[1]> = {}) {
  const events: ExecutionEvent[] = [];
  const calls: ActionRequest[] = [];
  const executor: ActionExecutor = { execute: async (req, ctl) => (calls.push(req), script(req, ctl.signal)) };
  const result = runWorkflow(doc, { executionId: "x", executor, onEvent: (e) => events.push(e), subflows: provider, ...over });
  return { events, calls, result };
}
const call = (id: string, to: string, args: Record<string, ConfigValue> = {}) => [id, "flow.subflow", { automationId: to, ...args }] as [string, string, Record<string, ConfigValue>];

describe("Chamar fluxo (subfluxo)", () => {
  it("passa parâmetros (variáveis do fluxo chamado) e devolve as variáveis finais", async () => {
    library.clear();
    library.set("soma", flow("soma", "Somar", [["set", "data.set_variable", { name: "total", value: "{{variables.a}}" }]], { a: { type: "number", value: 1 }, total: { type: "number", value: 0 } }));
    const main = flow("main", "Principal", [call("sub", "soma", { "arg.a": "{{variables.x}}" }), ["usa", "data.set_variable", { name: "r", value: "{{nodes.sub.outputs.total}}" }]], {
      x: { type: "number", value: 41 },
      r: { type: "number", value: 0 },
    });
    const { result, events } = run(main);
    const res = await result;
    expect(res.status).toBe("completed");
    expect(res.variables).toMatchObject({ r: 41 }); // número chegou como número (tipo declarado no fluxo chamado)
    // eventos do fluxo chamado ficam identificáveis pelo prefixo do nó que chamou
    const ids = events.filter((e) => e.type === "node_started").map((e) => (e as { nodeId: string }).nodeId);
    expect(ids).toEqual(["start", "sub", "sub/start", "sub/set", "sub/end", "usa", "end"]);
    expect(events.filter((e) => e.type === "execution_started" || e.type === "execution_finished")).toHaveLength(2); // só os do fluxo de fora
    const lbl = events.find((e) => e.type === "node_started" && e.nodeId === "sub/set") as Extract<ExecutionEvent, { type: "node_started" }>;
    expect(lbl.label).toBe("Somar › Definir variável");
  });

  it("parâmetro vazio mantém o padrão do fluxo chamado; as variáveis do chamador não vazam", async () => {
    library.clear();
    library.set("c", flow("c", "C", [["s", "data.set_variable", { name: "novo", value: "criada dentro" }]], { p: { type: "string", value: "padrão" } }));
    const main = flow("main", "P", [call("sub", "c", { "arg.p": "" }), ["lê", "data.set_variable", { name: "o", value: "{{nodes.sub.outputs.p}}" }]], { o: { type: "string", value: "" } });
    const res = await run(main).result;
    expect(res.variables?.["o"]).toBe("padrão");
    expect(res.variables).not.toHaveProperty("novo"); // contexto isolado
  });

  it("recusa parâmetro que o fluxo chamado não declara", async () => {
    library.clear();
    library.set("c", flow("c", "C", [], { p: { type: "string", value: "" } }));
    const res = await run(flow("main", "P", [call("sub", "c", { "arg.inexistente": "1" })])).result;
    expect(res).toMatchObject({ status: "failed", failedNodeId: "sub", error: { code: "INVALID_CONFIG" } });
    expect(res.error?.message).toContain("inexistente");
  });

  it("valor de parâmetro incompatível com o tipo declarado falha apontando o nó que chamou", async () => {
    library.clear();
    library.set("c", flow("c", "C", [], { n: { type: "number", value: 0 } }));
    const res = await run(flow("main", "P", [call("sub", "c", { "arg.n": "abc" })])).result;
    expect(res).toMatchObject({ status: "failed", failedNodeId: "sub" });
  });

  it("falha dentro do fluxo chamado: o nó que chamou falha com o nome do fluxo, o nó interno e a causa", async () => {
    library.clear();
    library.set("c", flow("c", "Rotina", [["w", "flow.wait", { seconds: 0 }]]));
    const res = await run(flow("main", "P", [call("sub", "c")]), (r) => (r.nodeId === "w" ? { kind: "failed", error: { code: "X", message: "deu ruim" } } : { kind: "completed", outputs: {} })).result;
    expect(res).toMatchObject({ status: "failed", failedNodeId: "sub", error: { code: "SUBFLOW_FAILED" } });
    expect(res.error?.message).toMatch(/Chamar fluxo: O fluxo “Rotina” falhou \(nó w\): .*deu ruim/);
  });

  it("falha do motor dentro do subfluxo continua não-continuável (não vira SUBFLOW_FAILED)", async () => {
    library.clear();
    library.set("c", flow("c", "C", [["w", "flow.wait", { seconds: 0 }]]));
    const main = flow("main", "P", [call("sub", "c")]);
    main.settings.errorPolicy = "continue";
    const res = await run(main, () => ({ kind: "failed", error: { code: "ENGINE_CRASHED", message: "caiu" } })).result;
    expect(res).toMatchObject({ status: "failed", error: { code: "ENGINE_CRASHED" } });
  });

  it("política 'continuar' do fluxo de fora segue após falha do subfluxo comum e termina com avisos", async () => {
    library.clear();
    library.set("c", flow("c", "C", [["w", "flow.wait", { seconds: 0 }]]));
    const main = flow("main", "P", [call("sub", "c")]);
    main.settings.errorPolicy = "continue";
    const res = await run(main, () => ({ kind: "failed", error: { code: "X", message: "ruim" } })).result;
    expect(res).toMatchObject({ status: "completed_with_warnings", warnings: 1 });
  });

  it("a saída 'Erro' do nó Chamar fluxo trata a falha", async () => {
    library.clear();
    library.set("c", flow("c", "C", [["w", "flow.wait", { seconds: 0 }]]));
    const main = createEmptyWorkflow("main", "P");
    add(main, "sub", "flow.subflow", { automationId: "c" });
    add(main, "tratou", "data.set_variable", { name: "ok", value: "sim" });
    add(main, "end", "flow.end", {});
    main.variables = { ok: { type: "string", value: "não" } };
    link(main, "start", "next", "sub");
    link(main, "sub", "error", "tratou");
    link(main, "tratou", "next", "end");
    const res = await run(main, () => ({ kind: "failed", error: { code: "X", message: "ruim" } })).result;
    expect(res.status).toBe("completed");
    expect(res.variables?.["ok"]).toBe("sim");
  });

  it("fluxo chamado inexistente, arquivado ou sem versão salva: erro do provedor com o nó apontado", async () => {
    library.clear();
    const res = await run(flow("main", "P", [call("sub", "nao-existe")])).result;
    expect(res).toMatchObject({ status: "failed", failedNodeId: "sub", error: { code: "SUBFLOW_NOT_FOUND" } });
  });

  it("sem provedor de fluxos: mensagem clara (nunca exceção)", async () => {
    library.clear();
    const res = await run(flow("main", "P", [call("sub", "x")]), okScript, { subflows: undefined }).result;
    expect(res).toMatchObject({ status: "failed", error: { code: "INVALID_CONFIG" } });
  });

  it("o fluxo chamado é validado: com erros, não executa e diz por quê", async () => {
    library.clear();
    const bad = flow("bad", "Quebrado", [["w", "flow.wait", { seconds: -5 }]]);
    library.set("bad", bad);
    const { result, calls } = run(flow("main", "P", [call("sub", "bad")]));
    const res = await result;
    expect(res).toMatchObject({ status: "failed", failedNodeId: "sub" });
    expect(res.error?.message).toContain("Quebrado");
    expect(res.error?.message).toMatch(/erro/);
    expect(calls).toHaveLength(0);
  });

  it("ciclo A → B → A é detectado antes de rodar de novo", async () => {
    library.clear();
    library.set("A", flow("A", "A", [call("toB", "B")]));
    library.set("B", flow("B", "B", [call("toA", "A")]));
    const res = await run(library.get("A")!).result;
    expect(res).toMatchObject({ status: "failed", error: { code: "SUBFLOW_FAILED" } });
    expect(res.error?.message).toContain("ciclo");
  });

  it("um fluxo chamando a si mesmo também é recusado em execução", async () => {
    library.clear();
    library.set("A", flow("A", "A", [call("self", "A")]));
    const res = await run(library.get("A")!).result;
    expect(res.status).toBe("failed");
  });

  it(`profundidade máxima (${MAX_SUBFLOW_DEPTH})`, async () => {
    library.clear();
    for (let i = 0; i < 8; i++) library.set(`F${i}`, flow(`F${i}`, `F${i}`, i < 7 ? [call("n", `F${i + 1}`)] : []));
    const res = await run(library.get("F0")!).result;
    expect(res.status).toBe("failed");
    expect(res.error?.message).toContain("máximo");
    library.clear();
    for (let i = 0; i < MAX_SUBFLOW_DEPTH; i++) library.set(`G${i}`, flow(`G${i}`, `G${i}`, i < MAX_SUBFLOW_DEPTH - 1 ? [call("n", `G${i + 1}`)] : []));
    expect((await run(library.get("G0")!).result).status).toBe("completed"); // exatamente no limite funciona
  });

  it("cancelar durante o subfluxo cancela tudo", async () => {
    library.clear();
    library.set("c", flow("c", "C", [["w", "flow.wait", { seconds: 0 }]]));
    const ac = new AbortController();
    const { result } = run(flow("main", "P", [call("sub", "c")]), (_r, sig) => (ac.abort(), hang(_r, sig)), { signal: ac.signal });
    expect((await result).status).toBe("cancelled");
  });

  it("o tempo limite do fluxo de FORA vale durante o subfluxo, e a pausa dentro dele não conta", async () => {
    library.clear();
    library.set("c", flow("c", "C", [["w", "flow.wait", { seconds: 0 }]]));
    // 1) estoura o tempo de fora enquanto o subfluxo espera
    const slow = flow("main", "P", [call("sub", "c")]);
    slow.settings.timeoutSeconds = 1;
    const t0 = Date.now();
    const res = await run(slow, hang, { timeoutMs: 150 }).result;
    expect(res).toMatchObject({ status: "failed", error: { code: "TIMEOUT" } });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("pausa e passo a passo entram no fluxo chamado (nós com prefixo) e a pausa não consome o tempo limite", async () => {
    library.clear();
    library.set("c", flow("c", "Interno", [["w", "flow.wait", { seconds: 0 }]]));
    const control = new RunControl({ startPaused: false });
    control.setBreakpoints(["sub/w"]); // breakpoint DENTRO do fluxo chamado
    const main = flow("main", "P", [call("sub", "c")]);
    const { events, result } = run(main, okScript, { control, timeoutMs: 400 });
    const until = async () => {
      for (let i = 0; i < 200 && !events.some((e) => e.type === "execution_paused"); i++) await new Promise((r) => setTimeout(r, 5));
    };
    await until();
    const paused = events.find((e) => e.type === "execution_paused") as Extract<ExecutionEvent, { type: "execution_paused" }>;
    expect(paused).toMatchObject({ nodeId: "sub/w", reason: "breakpoint", label: "Interno › Esperar" });
    await new Promise((r) => setTimeout(r, 700)); // mais que o tempo limite total (400 ms)
    control.setBreakpoints([]);
    control.resume();
    expect((await result).status).toBe("completed"); // a pausa não contou: nem para o fluxo de dentro nem para o de fora
  });

  it("aninhado em dois níveis: ids com prefixo composto e retorno só do nível chamado", async () => {
    library.clear();
    library.set("B", flow("B", "B", [["s", "data.set_variable", { name: "v", value: "fundo" }]], { v: { type: "string", value: "" } }));
    library.set("A", flow("A", "A", [call("b", "B"), ["g", "data.set_variable", { name: "v2", value: "{{nodes.b.outputs.v}}" }]], { v2: { type: "string", value: "" } }));
    const main = flow("main", "P", [call("a", "A"), ["g2", "data.set_variable", { name: "r", value: "{{nodes.a.outputs.v2}}" }]], { r: { type: "string", value: "" } });
    const { result, events } = run(main);
    const res = await result;
    expect(res.variables?.["r"]).toBe("fundo");
    expect(events.some((e) => e.type === "node_started" && e.nodeId === "a/b/s")).toBe(true);
  });
});

describe("nó de plugin declarativo (ADR 0014)", () => {
  async function withPlugin(fn: () => Promise<void>) {
    const { parsePlugin } = await import("@automation-studio/workflow-validator");
    const { setPluginNodes } = await import("@automation-studio/node-registry");
    const inner = flow("p", "interno", [["s", "data.set_variable", { name: "saudacao", value: "Olá, {{variables.nome}}!" }]], { nome: { type: "string", value: "mundo" }, saudacao: { type: "string", value: "" } });
    const r = parsePlugin(JSON.stringify({ format: "automation-studio.plugin", formatVersion: 1, id: "saudacao", name: "Montar saudação", version: "1.0.0", description: "d", fields: [{ key: "nome", label: "Nome", kind: "text" }], returns: ["saudacao"], flow: inner }));
    if (!r.ok) throw new Error(r.message);
    setPluginNodes([r.node]);
    try {
      await fn();
    } finally {
      setPluginNodes([]);
    }
  }
  const useIt = (cfg: Record<string, ConfigValue>) =>
    flow("main", "P", [["pl", "plugin.saudacao", cfg], ["guarda", "data.set_variable", { name: "r", value: "{{nodes.pl.saudacao}}" }]], { r: { type: "string", value: "" }, quem: { type: "string", value: "Hector" } });

  it("executa o fluxo interno com os campos como variáveis e devolve os retornos como resultados do nó", async () => {
    await withPlugin(async () => {
      const { result, events } = run(useIt({ nome: "{{variables.quem}}" }));
      const res = await result;
      expect(res.status).toBe("completed");
      expect(res.variables?.["r"]).toBe("Olá, Hector!");
      expect(events.some((e) => e.type === "node_started" && e.nodeId === "pl/s")).toBe(true);
      const lbl = events.find((e) => e.type === "node_started" && e.nodeId === "pl/s") as Extract<ExecutionEvent, { type: "node_started" }>;
      expect(lbl.label).toBe("Montar saudação › Definir variável");
    });
  });

  it("campo vazio usa o padrão do fluxo interno", async () => {
    await withPlugin(async () => {
      expect((await run(useIt({})).result).variables?.["r"]).toBe("Olá, mundo!");
    });
  });

  it("plugin desativado/removido: o fluxo que o usa NÃO executa (tipo de nó desconhecido), sem exceção", async () => {
    let main!: WorkflowDocument;
    await withPlugin(async () => {
      main = useIt({}); // montado com o plugin ativo...
    });
    const res = await run(main).result; // ...e executado depois de ele sair do registro
    expect(res).toMatchObject({ status: "failed", error: { code: "INVALID_WORKFLOW" } });
    expect(res.error?.message).toContain("plugin.saudacao");
  });

  it("não pode sobrepor nó embutido nem usar outro prefixo", async () => {
    const { setPluginNodes, getNodeDefinition } = await import("@automation-studio/node-registry");
    const fake = { ...getNodeDefinition("flow.wait")!, type: "flow.wait", label: "Falso" };
    const fake2 = { ...getNodeDefinition("flow.wait")!, type: "meu.no", label: "Falso2" };
    setPluginNodes([fake, fake2]);
    expect(getNodeDefinition("flow.wait")!.label).not.toBe("Falso");
    expect(getNodeDefinition("meu.no")).toBeUndefined();
  });
});
