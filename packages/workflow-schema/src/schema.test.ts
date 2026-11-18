import { describe, expect, it } from "vitest";
import { createEmptyWorkflow, parseWorkflowDocument, WORKFLOW_SCHEMA_VERSION } from "./index.js";

const valid = () => createEmptyWorkflow("a1", "Meu fluxo");
const bad = (doc: unknown) => {
  const r = parseWorkflowDocument(doc);
  if (r.ok) throw new Error("deveria ter falhado");
  return r.message;
};

describe("workflow schema", () => {
  it("aceita o fluxo inicial e faz ida e volta por JSON sem perda", () => {
    const doc = valid();
    const r = parseWorkflowDocument(JSON.parse(JSON.stringify(doc)));
    expect(r).toEqual({ ok: true, doc });
  });

  it("separa dados visuais da config executável", () => {
    const doc = valid();
    expect(doc.nodes[0]).not.toHaveProperty("position");
    expect(doc.visual.positions["start"]).toEqual({ x: 80, y: 120 });
  });

  it("rejeita schemaVersion desconhecida com mensagem clara", () => {
    expect(bad({ ...valid(), schemaVersion: 2 })).toMatch(/versão de schema 2 não suportada/i);
    expect(WORKFLOW_SCHEMA_VERSION).toBe(1);
  });

  it.each([
    ["null", null],
    ["string", "texto"],
    ["sem nodes", { ...valid(), nodes: undefined }],
    ["campo extra no topo", { ...valid(), admin: true }],
    ["campo extra no nó", { ...valid(), nodes: [{ id: "n", type: "t", version: 1, config: {}, position: { x: 0, y: 0 } }] }],
    ["config com objeto aninhado", { ...valid(), nodes: [{ id: "n", type: "t", version: 1, config: { a: { b: 1 } } }] }],
    ["posição infinita", { ...valid(), visual: { positions: { start: { x: Infinity, y: 0 } } } }],
    ["nome de variável inválido", { ...valid(), variables: { "1x": { type: "string", value: "" } } }],
    ["errorPolicy inválida", { ...valid(), settings: { timeoutSeconds: 10, errorPolicy: "yolo" } }],
    ["timeout zero", { ...valid(), settings: { timeoutSeconds: 0, errorPolicy: "stop" } }],
  ])("rejeita %s", (_n, doc) => {
    expect(bad(doc)).toMatch(/inválido|não suportada/i);
  });

  it("indica o caminho do problema", () => {
    expect(bad({ ...valid(), settings: { timeoutSeconds: 0, errorPolicy: "stop" } })).toContain("settings.timeoutSeconds");
  });
});
