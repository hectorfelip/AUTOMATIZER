import { beforeEach, describe, expect, it } from "vitest";
import { defaultConfig, getNodeDefinition } from "@automation-studio/node-registry";
import { createEmptyWorkflow, type ConfigValue, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { hasErrors, scanTemplate, validateWorkflow, type IssueCode } from "./index.js";

let doc: WorkflowDocument;
const node = (id: string, type: string, config: Record<string, ConfigValue> = {}) => {
  doc.nodes.push({ id, type, version: 1, config: { ...defaultConfig(getNodeDefinition(type)!), ...config } });
};
const edge = (source: string, sourceHandle: string, target: string, targetHandle = "input") => {
  doc.edges.push({ id: `${source}.${sourceHandle}>${target}`, source, sourceHandle, target, targetHandle });
};
const codes = () => validateWorkflow(doc).map((i) => i.code);
const find = (code: IssueCode) => validateWorkflow(doc).find((i) => i.code === code);

/** Fluxo válido: start → esperar → fim. */
beforeEach(() => {
  doc = createEmptyWorkflow("f", "Teste");
  node("w", "flow.wait", { seconds: 2 });
  node("end", "flow.end");
  edge("start", "next", "w");
  edge("w", "next", "end");
});

describe("validateWorkflow — fluxo válido", () => {
  it("não tem problemas", () => {
    expect(validateWorkflow(doc)).toEqual([]);
  });
  it("fluxo recém-criado (só o início) também é válido", () => {
    expect(validateWorkflow(createEmptyWorkflow("x", "x"))).toEqual([]);
  });
});

describe("estrutura", () => {
  it("sem início", () => {
    doc.nodes = doc.nodes.filter((n) => n.id !== "start");
    doc.edges = doc.edges.filter((e) => e.source !== "start");
    expect(codes()).toContain("NO_START");
  });
  it("início duplicado aponta o segundo nó", () => {
    node("start2", "trigger.manual");
    const i = find("DUPLICATE_UNIQUE_NODE")!;
    expect(i).toMatchObject({ severity: "error", nodeId: "start2" });
    expect(i.message).toContain("Início manual");
  });
  it("id de nó repetido e tipo desconhecido", () => {
    node("w", "flow.wait");
    doc.nodes.push({ id: "x", type: "foo.bar", version: 1, config: {} });
    expect(codes()).toEqual(expect.arrayContaining(["DUPLICATE_NODE_ID", "UNKNOWN_NODE_TYPE"]));
  });
  it("versão de nó não suportada", () => {
    doc.nodes.find((n) => n.id === "w")!.version = 9;
    expect(find("UNSUPPORTED_NODE_VERSION")?.nodeId).toBe("w");
  });
});

describe("conexões", () => {
  it("nó inexistente", () => {
    edge("w", "next", "fantasma");
    expect(codes()).toContain("EDGE_UNKNOWN_NODE");
  });
  it("porta inexistente (origem e destino)", () => {
    edge("w", "success", "end");
    edge("end", "next", "w");
    edge("w", "next", "end", "saida");
    expect(codes().filter((c) => c === "EDGE_UNKNOWN_PORT").length).toBeGreaterThanOrEqual(2);
  });
  it("auto-ligação", () => {
    edge("w", "next", "w");
    // a saída 'next' de w já estava usada; a porta é checada primeiro e o auto-loop vem antes do uso
    expect(codes()).toContain("EDGE_SELF_LOOP");
  });
  it("saída com duas conexões", () => {
    node("w2", "flow.wait");
    edge("w", "next", "w2");
    const i = find("OUTPUT_ALREADY_CONNECTED")!;
    expect(i.message).toContain("já está conectada");
  });
  it("id de conexão repetido", () => {
    doc.edges.push({ ...doc.edges[0]! });
    expect(codes()).toContain("DUPLICATE_EDGE_ID");
  });
});

describe("parâmetros", () => {
  it("campo obrigatório vazio aponta nó e campo", () => {
    node("mv", "files.move");
    const issues = validateWorkflow(doc).filter((i) => i.code === "REQUIRED_FIELD" && i.nodeId === "mv");
    expect(issues.map((i) => i.field).sort()).toEqual(["destination", "source"]);
    expect(issues[0]!.message).toMatch(/Mover arquivo: o campo “(Origem|Destino)” é obrigatório/);
  });
  it("branco (só espaços) conta como vazio", () => {
    node("mv", "files.move", { source: "   ", destination: "C:\\x" });
    expect(validateWorkflow(doc).some((i) => i.nodeId === "mv" && i.field === "source" && i.code === "REQUIRED_FIELD")).toBe(true);
  });
  it.each([
    ["número fora do mínimo", { seconds: -1 }],
    ["número acima do máximo", { seconds: 99_999 }],
    ["número como texto", { seconds: "abc" }],
    ["NaN não chega, mas string vazia é obrigatório", { seconds: "" }],
  ])("flow.wait: %s", (_n, cfg) => {
    doc.nodes.find((n) => n.id === "w")!.config = cfg as Record<string, ConfigValue>;
    expect(hasErrors(validateWorkflow(doc))).toBe(true);
  });
  it("select com opção inválida e boolean com texto", () => {
    node("c", "flow.condition", { left: "1", operator: "maior_que_talvez", right: "2" });
    node("l", "files.list", { path: "C:\\x", recursive: "sim" });
    const fields = validateWorkflow(doc).filter((i) => i.code === "INVALID_FIELD").map((i) => i.field);
    expect(fields).toEqual(expect.arrayContaining(["operator", "recursive"]));
  });
  it("padrão do nome da variável", () => {
    node("sv", "data.set_variable", { name: "1 inválido", value: "x" });
    expect(find("INVALID_FIELD")?.message).toContain("Use letras, números e _");
  });
  it("número aceita variável; número fora do intervalo com variável não é checado", () => {
    doc.variables["n"] = { type: "number", value: 5 };
    doc.nodes.find((n) => n.id === "w")!.config = { seconds: "{{variables.n}}" };
    expect(validateWorkflow(doc)).toEqual([]);
  });
});

describe("variáveis e expressões", () => {
  it("variável inexistente", () => {
    node("l", "files.list", { path: "{{variables.pasta}}" });
    const i = find("UNKNOWN_VARIABLE")!;
    expect(i).toMatchObject({ nodeId: "l", field: "path" });
    expect(i.message).toContain("“pasta”");
  });
  it("variável declarada ou definida por nó 'definir variável' é conhecida", () => {
    doc.variables["pasta"] = { type: "string", value: "C:\\x" };
    node("sv", "data.set_variable", { name: "outra", value: "1" });
    node("l", "files.list", { path: "{{variables.pasta}}\\{{ variables.outra }}" });
    expect(codes()).not.toContain("UNKNOWN_VARIABLE");
  });
  it("expressão arbitrária é rejeitada (sem eval)", () => {
    node("t", "input.type_text", { text: "{{ process.exit(1) }}" });
    expect(find("BAD_EXPRESSION")?.message).toContain("Expressão não suportada");
  });
  it("chaves desbalanceadas", () => {
    node("t", "input.type_text", { text: "olá {{variables.x" });
    expect(codes()).toContain("BAD_EXPRESSION");
  });
  it("tipo do valor da variável não confere", () => {
    doc.variables["n"] = { type: "number", value: "texto" };
    expect(find("INVALID_VARIABLE")?.message).toContain("tipo number");
  });
  it("scanTemplate", () => {
    expect(scanTemplate("a {{variables.x}} b {{ variables.y_1 }}")).toEqual({ variables: ["x", "y_1"], errors: [] });
    expect(scanTemplate("sem nada")).toEqual({ variables: [], errors: [] });
    expect(scanTemplate("{{variables.a.b}}").errors).toHaveLength(1);
  });
});

describe("alcançabilidade e ciclos", () => {
  it("nó solto é avisado, não é erro", () => {
    node("solto", "flow.wait");
    const i = find("UNREACHABLE_NODE")!;
    expect(i).toMatchObject({ severity: "warning", nodeId: "solto" });
    expect(hasErrors(validateWorkflow(doc))).toBe(false);
  });
  it("ciclo sem decisão = aviso de loop infinito", () => {
    node("w2", "flow.wait");
    doc.edges = doc.edges.filter((e) => e.target !== "end");
    edge("w", "next", "w2");
    edge("w2", "next", "w");
    expect(find("CYCLE_NO_EXIT")?.severity).toBe("warning");
  });
  it("ciclo passando por 'Repetir' ou 'Se/Senão' é legítimo", () => {
    doc = createEmptyWorkflow("f", "t");
    node("r", "flow.repeat", { times: 3 });
    node("w", "flow.wait");
    node("end", "flow.end");
    edge("start", "next", "r");
    edge("r", "body", "w");
    edge("w", "next", "r");
    edge("r", "done", "end");
    expect(validateWorkflow(doc)).toEqual([]);
  });
  it("muitos nós em cadeia não estouram a pilha", () => {
    doc = createEmptyWorkflow("f", "t");
    let prev = "start";
    for (let i = 0; i < 1500; i++) {
      node(`n${i}`, "flow.wait");
      edge(prev, "next", `n${i}`);
      prev = `n${i}`;
    }
    expect(validateWorkflow(doc)).toEqual([]);
  });
});
