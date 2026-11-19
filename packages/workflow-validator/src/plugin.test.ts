import { describe, expect, it } from "vitest";
import { createEmptyWorkflow } from "@automation-studio/workflow-schema";
import { PLUGIN_FORMAT, MAX_PLUGIN_BYTES, parsePlugin } from "./index.js";

const flow = () => {
  const d = createEmptyWorkflow("p", "interno");
  d.variables = { nome: { type: "string", value: "mundo" }, saudacao: { type: "string", value: "" }, vezes: { type: "number", value: 1 } };
  d.nodes.push({ id: "s", type: "data.set_variable", version: 1, config: { name: "saudacao", value: "Olá, {{variables.nome}}!" } }, { id: "end", type: "flow.end", version: 1, config: {} });
  d.edges.push({ id: "e1", source: "start", sourceHandle: "next", target: "s", targetHandle: "input" }, { id: "e2", source: "s", sourceHandle: "next", target: "end", targetHandle: "input" });
  return d;
};
const make = (over: Record<string, unknown> = {}) => ({
  format: PLUGIN_FORMAT, formatVersion: 1, id: "saudacao", name: "Montar saudação", version: "1.0.0", description: "Monta uma saudação.",
  fields: [{ key: "nome", label: "Nome", kind: "text", required: true }], returns: ["saudacao"], flow: flow(), ...over,
});
const parse = (o: unknown) => parsePlugin(JSON.stringify(o));
const fail = (o: unknown) => {
  const r = parse(o);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.message;
};

describe("parsePlugin", () => {
  it("aceita um plugin válido e gera a definição do nó", () => {
    const r = parse(make());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.info).toMatchObject({ id: "saudacao", nodeType: "plugin.saudacao", fieldCount: 1, returns: ["saudacao"], nodeCount: 3 });
    expect(r.node).toMatchObject({ type: "plugin.saudacao", category: "plugins", label: "Montar saudação" });
    expect(r.node.fields[0]).toMatchObject({ key: "nome", kind: "text", required: true, default: "mundo" }); // padrão vem da variável
    expect(r.node.results?.map((x) => x.key)).toEqual(["saudacao", "status"]);
    expect(r.node.outputs.map((o) => o.id)).toEqual(["success", "error"]);
  });

  it.each<[string, unknown, RegExp]>([
    ["não é JSON", "{ruim", /JSON válido/],
    ["outro formato", { format: "x" }, /não parece um plugin/],
    ["versão futura do formato", make({ formatVersion: 2 }), /Versão de plugin 2 não suportada/],
    ["id inválido", make({ id: "Ruim Id" }), /id deve ter/],
    ["id curto demais", make({ id: "a" }), /id deve ter/],
    ["versão malformada", make({ version: "v1" }), /1\.0\.0/],
    ["campo extra no plugin", make({ codigo: "import os" }), /inválido/],
    ["campo extra num campo", make({ fields: [{ key: "nome", label: "N", kind: "text", exec: "x" }] }), /inválido/],
    ["campo com tipo de nó desconhecido", make({ fields: [{ key: "nome", label: "N", kind: "path" }] }), /inválido/],
  ])("rejeita: %s", (_n, input, msg) => {
    const r = typeof input === "string" ? parsePlugin(input) : parse(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(msg);
  });

  it("só combina nós EMBUTIDOS: recusa plugin dentro de plugin, tipo desconhecido e Chamar fluxo", () => {
    for (const [type, msg] of [["plugin.outro", /não é um nó embutido/], ["tipo.inexistente", /não é um nó embutido/], ["flow.subflow", /Chamar fluxo/]] as const) {
      const f = flow();
      f.nodes.push({ id: "x", type, version: 1, config: {} });
      expect(fail(make({ flow: f }))).toMatch(msg);
    }
  });

  it("o fluxo interno é validado como qualquer outro (erros impedem o plugin)", () => {
    const f = flow();
    f.nodes.find((n) => n.id === "s")!.config["value"] = "{{variables.inexistente}}";
    expect(fail(make({ flow: f }))).toMatch(/fluxo interno tem 1 erro/);
    const sem = flow();
    sem.nodes = sem.nodes.filter((n) => n.id !== "start");
    expect(fail(make({ flow: sem }))).toMatch(/Início manual|erro/);
    expect(fail(make({ flow: { lixo: true } }))).toMatch(/Fluxo interno inválido/);
  });

  it("campos e retornos precisam existir como variáveis do fluxo interno, com o mesmo tipo", () => {
    expect(fail(make({ fields: [{ key: "naoexiste", label: "X", kind: "text" }] }))).toMatch(/variável de mesmo nome/);
    expect(fail(make({ fields: [{ key: "nome", label: "N", kind: "number" }] }))).toMatch(/é number, mas a variável/);
    expect(fail(make({ fields: [{ key: "nome", label: "A", kind: "text" }, { key: "nome", label: "B", kind: "text" }] }))).toMatch(/repetido/);
    expect(fail(make({ returns: ["fantasma"] }))).toMatch(/não existe como variável/);
    const f = flow();
    f.variables["status"] = { type: "string", value: "" };
    expect(fail(make({ flow: f, returns: ["status"] }))).toMatch(/reservado/);
  });

  it("limites: arquivo grande, fluxo com nós demais", () => {
    expect(parsePlugin(" ".repeat(MAX_PLUGIN_BYTES + 1))).toMatchObject({ ok: false });
    const f = flow();
    for (let i = 0; i < 201; i++) f.nodes.push({ id: `n${i}`, type: "flow.wait", version: 1, config: { seconds: 0 } });
    expect(fail(make({ flow: f }))).toMatch(/nós demais/);
  });
});

describe("exemplo da documentação", () => {
  it("docs/examples/saudacao.asplugin.json é um plugin válido (a doc nunca apodrece)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const text = readFileSync(fileURLToPath(new URL("../../../docs/examples/saudacao.asplugin.json", import.meta.url)), "utf8");
    const r = parsePlugin(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.fields.map((f) => f.key)).toEqual(["nome", "idade"]);
  });
});
