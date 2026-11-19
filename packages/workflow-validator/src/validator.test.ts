import { beforeEach, describe, expect, it } from "vitest";
import { defaultConfig, getNodeDefinition } from "@automation-studio/node-registry";
import { createEmptyWorkflow, type ConfigValue, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { availableReferences, hasErrors, scanTemplate, validateWorkflow, type IssueCode } from "./index.js";

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
  it("nome de variável precisa ser fixo: {{...}} é recusado (o padrão não seria checado)", () => {
    node("sv", "data.set_variable", { name: "{{variables.x}}", value: "1" });
    expect(find("INVALID_FIELD")?.message).toContain("não aceita variáveis");
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
  it("scanTemplate: variáveis", () => {
    const scan = scanTemplate("a {{variables.x}} b {{ variables.y_1 }}");
    expect(scan.refs.map((r) => r.raw)).toEqual(["variables.x", "variables.y_1"]);
    expect(scan.errors).toEqual([]);
    expect(scan.whole).toBeNull(); // há texto em volta
    expect(scanTemplate("sem nada")).toEqual({ refs: [], errors: [], whole: null });
    expect(scanTemplate("{{variables.a.b}}").errors).toHaveLength(1);
  });
});

// ---------- referências: resultados de nós e "Para cada item" ----------
const flowListEach = (itemsRef = "{{nodes.list.files}}", itemName = "item") => {
  doc = createEmptyWorkflow("f", "T");
  node("list", "files.list", { path: "C:\\x" });
  node("each", "flow.foreach", { items: itemsRef, itemName });
  node("mv", "files.move", { source: `{{${itemName}.path}}`, destination: "C:\\out" });
  node("end", "flow.end");
  edge("start", "next", "list");
  edge("list", "success", "each");
  edge("each", "body", "mv");
  edge("mv", "success", "each"); // volta ao laço
  edge("each", "done", "end");
};
const issuesFor = (nodeId: string) => validateWorkflow(doc).filter((i) => i.nodeId === nodeId);

describe("scanTemplate: nodes e item", () => {
  it("reconhece as três formas e preserva o tipo quando a referência é o texto todo", () => {
    expect(scanTemplate("{{nodes.listar.count}}").whole).toMatchObject({ kind: "nodes", nodeId: "listar", key: "count", path: [] });
    expect(scanTemplate("{{item.name}}").whole).toMatchObject({ kind: "loop", name: "item", path: ["name"] });
    expect(scanTemplate("{{ item }}").whole).toMatchObject({ kind: "loop", name: "item", path: [] });
    expect(scanTemplate("pasta {{item.extension}}").whole).toBeNull();
    expect(scanTemplate("{{nodes.abrir-bloco-3f2a.pid}}").refs[0]).toMatchObject({ nodeId: "abrir-bloco-3f2a" }); // id com hífen
    expect(scanTemplate("{{nodes.l.files.0.name}}").refs[0]).toMatchObject({ path: ["0", "name"] }); // posição na lista
  });
  it.each([
    ["{{process.exit(1)}}"], ["{{a..b}}"], ["{{nodes.x}}"], ["{{nodes}}"], ["{{variables}}"], ["{{variables.a.b}}"],
    ["{{item.}}"], ["{{1x}}"], ["{{item.a-b}}"], ["{{ item + 1 }}"], ["{{`x`}}"], ["{{item['name']}}"],
  ])("rejeita expressão arbitrária: %s", (t) => {
    expect(scanTemplate(t).errors.length).toBeGreaterThan(0);
    expect(scanTemplate(t).whole).toBeNull();
  });
  it.each([["{{item.constructor}}"], ["{{item.__proto__}}"], ["{{nodes.l.files.prototype}}"], ["{{constructor}}"], ["{{variables.__proto__}}"]])(
    "nunca permite acesso a internals do JavaScript: %s", (t) => {
      expect(scanTemplate(t).errors[0]).toMatch(/não permitida/);
    },
  );
});

describe("resultados de nós", () => {
  beforeEach(() => {
    doc = createEmptyWorkflow("f", "T");
    node("list", "files.list", { path: "C:\\x" });
    edge("start", "next", "list");
  });
  const withText = (text: string) => {
    node("t", "input.type_text", { text });
    edge("list", "success", "t");
  };

  it("usa o resultado de um nó anterior sem problemas", () => {
    withText("achei {{nodes.list.count}} arquivos");
    expect(issuesFor("t")).toEqual([]);
  });
  it("nó inexistente", () => {
    withText("{{nodes.fantasma.count}}");
    expect(issuesFor("t")[0]).toMatchObject({ code: "UNKNOWN_NODE_REF", severity: "error", field: "text" });
  });
  it("resultado inexistente lista os disponíveis", () => {
    withText("{{nodes.list.contagem}}");
    const i = issuesFor("t")[0]!;
    expect(i.code).toBe("UNKNOWN_RESULT");
    expect(i.message).toMatch(/Listar arquivos.*Disponíveis: count, files, folder, truncated/);
  });
  it("não pode usar o próprio resultado", () => {
    node("w", "flow.wait", { seconds: "{{nodes.w.waitedSeconds}}" });
    edge("list", "success", "w");
    expect(issuesFor("w")[0]).toMatchObject({ code: "SELF_REFERENCE" });
  });
  it("nó que talvez não rode antes é AVISO (não bloqueia)", () => {
    node("t", "input.type_text", { text: "{{nodes.list.count}}" }); // t não está ligado depois de list
    edge("start", "next", "t");
    edge("list", "success", "t"); // dois caminhos: há como chegar a t sem passar por list? sim: start→t
    const i = issuesFor("t");
    expect(i.some((x) => x.code === "NODE_NOT_BEFORE")).toBe(false); // list alcança t
    // agora um nó solto, sem caminho de list até ele
    node("solto", "input.type_text", { text: "{{nodes.list.count}}" });
    const w = issuesFor("solto").find((x) => x.code === "NODE_NOT_BEFORE")!;
    expect(w.severity).toBe("warning");
    expect(hasErrors(validateWorkflow(doc).filter((x) => x.nodeId === "solto" && x.code === "NODE_NOT_BEFORE"))).toBe(false);
  });
  it("valor simples não tem propriedades", () => {
    withText("{{nodes.list.count.abc}}");
    expect(issuesFor("t")[0]).toMatchObject({ code: "UNKNOWN_RESULT" });
  });
  it("uma lista inteira não cabe em campo de texto; uma posição cabe", () => {
    withText("{{nodes.list.files}}");
    expect(issuesFor("t")[0]).toMatchObject({ code: "NOT_A_LIST" });
    doc.nodes.find((n) => n.id === "t")!.config = { text: "{{nodes.list.files.0.name}}" };
    expect(issuesFor("t")).toEqual([]);
  });
  it("propriedade inexistente de um item da lista é erro de desenho", () => {
    withText("{{nodes.list.files.0.nmae}}");
    const i = issuesFor("t")[0]!;
    expect(i.code).toBe("UNKNOWN_ITEM_PROPERTY");
    expect(i.message).toMatch(/Disponíveis: name, stem, extension, path/);
  });
  it("lista exige posição numérica", () => {
    withText("{{nodes.list.files.name}}");
    expect(issuesFor("t")[0]).toMatchObject({ code: "NOT_A_LIST" });
  });
  it("campos numéricos aceitam resultado de nó", () => {
    node("r", "flow.repeat", { times: "{{nodes.list.count}}" });
    edge("list", "success", "r");
    expect(issuesFor("r")).toEqual([]);
  });
});

describe("Para cada item", () => {
  it("fluxo completo é válido (laço com volta ligada não é ciclo infinito)", () => {
    flowListEach();
    expect(validateWorkflow(doc)).toEqual([]);
  });
  it("o item só existe dentro do corpo do laço", () => {
    flowListEach();
    node("depois", "input.type_text", { text: "{{item.name}}" });
    edge("end", "next", "depois"); // (inválido, mas serve): fora do corpo
    doc.edges = doc.edges.filter((e) => e.source !== "each" || e.sourceHandle !== "done");
    edge("each", "done", "depois");
    const i = issuesFor("depois").find((x) => x.code === "UNKNOWN_LOOP_VARIABLE")!;
    expect(i.message).toContain("só existe dentro do corpo de um “Para cada item”");
  });
  it("o item não existe antes do laço nem na própria lista do laço", () => {
    flowListEach();
    doc.nodes.find((n) => n.id === "list")!.config = { path: "{{item.path}}" };
    expect(issuesFor("list").some((x) => x.code === "UNKNOWN_LOOP_VARIABLE")).toBe(true);
    doc.nodes.find((n) => n.id === "each")!.config = { items: "{{item.files}}", itemName: "item" };
    expect(issuesFor("each").some((x) => x.code === "UNKNOWN_LOOP_VARIABLE" || x.code === "NOT_A_LIST")).toBe(true);
  });
  it("valida a propriedade do item contra o que a lista declara", () => {
    flowListEach();
    doc.nodes.find((n) => n.id === "mv")!.config = { source: "{{item.pth}}", destination: "C:\\o" };
    const i = issuesFor("mv").find((x) => x.code === "UNKNOWN_ITEM_PROPERTY")!;
    expect(i.message).toContain("O item “item” não tem “pth”");
  });
  it("nome do item personalizado; o antigo deixa de existir", () => {
    flowListEach("{{nodes.list.files}}", "arquivo");
    expect(validateWorkflow(doc)).toEqual([]);
    doc.nodes.find((n) => n.id === "mv")!.config = { source: "{{item.path}}", destination: "C:\\o" };
    expect(issuesFor("mv").some((x) => x.code === "UNKNOWN_LOOP_VARIABLE")).toBe(true);
  });
  it("laços aninhados com nomes diferentes enxergam os dois itens", () => {
    doc = createEmptyWorkflow("f", "T");
    node("l1", "files.list", { path: "C:\\a" });
    node("fora", "flow.foreach", { items: "{{nodes.l1.files}}", itemName: "pasta" });
    node("l2", "files.list", { path: "{{pasta.path}}" });
    node("dentro", "flow.foreach", { items: "{{nodes.l2.files}}", itemName: "arq" });
    node("t", "input.type_text", { text: "{{pasta.name}}/{{arq.name}}" });
    node("end", "flow.end");
    edge("start", "next", "l1"); edge("l1", "success", "fora"); edge("fora", "body", "l2"); edge("l2", "success", "dentro");
    edge("dentro", "body", "t"); edge("t", "success", "dentro"); edge("dentro", "done", "fora"); edge("fora", "done", "end");
    expect(validateWorkflow(doc)).toEqual([]);
  });
  it("a lista precisa ser a referência a uma lista", () => {
    flowListEach();
    for (const bad of ["C:\\x", "{{nodes.list.count}}", "{{variables.v}}", "{{nodes.list.files.0}}", "a {{nodes.list.files}}"]) {
      doc.variables["v"] = { type: "string", value: "x" };
      doc.nodes.find((n) => n.id === "each")!.config = { items: bad, itemName: "item" };
      expect(issuesFor("each").some((x) => x.code === "NOT_A_LIST" || x.code === "BAD_EXPRESSION"), bad).toBe(true);
    }
  });
  it("nome do item: fixo, identificador e sem palavras reservadas", () => {
    flowListEach();
    for (const bad of ["variables", "nodes", "1x", "a-b", "{{variables.v}}"]) {
      doc.nodes.find((n) => n.id === "each")!.config = { items: "{{nodes.list.files}}", itemName: bad };
      expect(issuesFor("each").some((x) => x.field === "itemName" && x.code === "INVALID_FIELD"), bad).toBe(true);
    }
  });
});

describe("availableReferences (seletor da interface)", () => {
  it("só oferece resultados de nós que rodam ANTES, mais variáveis e o item do laço", () => {
    flowListEach();
    doc.variables["pasta"] = { type: "string", value: "x" };
    const refs = availableReferences(doc, "mv");
    expect(refs.variables).toEqual(["pasta"]);
    expect(refs.results.map((r) => r.ref)).toContain("{{nodes.list.count}}");
    expect(refs.results.map((r) => r.ref)).toContain("{{nodes.each.index}}"); // o próprio laço oferece posição e total
    expect(refs.results.some((r) => r.nodeId === "mv")).toBe(false); // nunca o próprio nó
    expect(refs.loops).toEqual([{ name: "item", refs: ["{{item}}", "{{item.name}}", "{{item.stem}}", "{{item.extension}}", "{{item.path}}", "{{item.folder}}", "{{item.size}}", "{{item.modifiedAt}}"] }]);
    // um nó antes da lista não vê nada disso
    expect(availableReferences(doc, "list").results).toEqual([]);
    expect(availableReferences(doc, "list").loops).toEqual([]);
  });
  it("tudo que o seletor oferece passa no validador", () => {
    flowListEach();
    const refs = availableReferences(doc, "mv");
    const usable = refs.results.filter((r) => r.type !== "list").map((r) => r.ref).concat(refs.loops.flatMap((l) => l.refs.filter((r) => r !== "{{item}}")));
    for (const ref of usable) {
      doc.nodes.find((n) => n.id === "mv")!.config = { source: ref, destination: "C:\\o" };
      expect(issuesFor("mv").filter((i) => i.severity === "error"), ref).toEqual([]);
    }
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
