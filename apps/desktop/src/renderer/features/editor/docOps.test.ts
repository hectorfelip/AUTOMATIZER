import { describe, expect, it } from "vitest";
import { createEmptyWorkflow } from "@automation-studio/workflow-schema";
import { hasErrors, validateWorkflow } from "@automation-studio/workflow-validator";
import {
  addNode, addVariable, connect, connectionProblem, convertVariableValue, duplicateNodes, moveNodes,
  removeEdges, removeNodes, removeVariable, renameVariable, setVariable, updateNodeConfig,
} from "./docOps";

const base = () => createEmptyWorkflow("f", "T");
const at = { x: 100.6, y: 50.2 };

describe("nós", () => {
  it("addNode usa defaults do contrato e arredonda a posição", () => {
    const d = addNode(base(), "flow.wait", at, "w");
    expect(d.nodes.at(-1)).toEqual({ id: "w", type: "flow.wait", version: 1, config: { seconds: 1 } });
    expect(d.visual.positions["w"]).toEqual({ x: 101, y: 50 });
  });
  it("não adiciona tipo desconhecido nem segundo início", () => {
    const d = base();
    expect(addNode(d, "foo.bar", at)).toBe(d);
    expect(addNode(d, "trigger.manual", at)).toBe(d);
  });
  it("ids gerados são únicos", () => {
    let d = base();
    for (let i = 0; i < 50; i++) d = addNode(d, "flow.wait", at);
    expect(new Set(d.nodes.map((n) => n.id)).size).toBe(51);
  });
  it("removeNodes leva junto conexões e posições; sem efeito = mesma referência", () => {
    let d = addNode(addNode(base(), "flow.wait", at, "a"), "flow.end", at, "z");
    d = connect(connect(d, { source: "start", sourceHandle: "next", target: "a", targetHandle: "input" }), { source: "a", sourceHandle: "next", target: "z", targetHandle: "input" });
    const r = removeNodes(d, ["a"]);
    expect(r.nodes.map((n) => n.id)).toEqual(["start", "z"]);
    expect(r.edges).toEqual([]);
    expect(Object.keys(r.visual.positions).sort()).toEqual(["start", "z"]);
    expect(removeNodes(d, ["nada"])).toBe(d);
  });
  it("moveNodes: mesma posição não altera", () => {
    const d = base();
    expect(moveNodes(d, { start: { x: 80.2, y: 119.9 } })).toBe(d);
    expect(moveNodes(d, { start: { x: 10, y: 10 } }).visual.positions["start"]).toEqual({ x: 10, y: 10 });
  });
  it("updateNodeConfig", () => {
    const d = addNode(base(), "flow.wait", at, "w");
    expect(updateNodeConfig(d, "w", "seconds", 5).nodes[1]!.config["seconds"]).toBe(5);
    expect(updateNodeConfig(d, "w", "seconds", 1)).toBe(d);
    expect(updateNodeConfig(d, "x", "seconds", 5)).toBe(d);
  });
});

describe("conexões", () => {
  const d = addNode(addNode(base(), "flow.wait", at, "a"), "flow.end", at, "z");
  const c = (source: string, sourceHandle: string, target: string, targetHandle = "input") => ({ source, sourceHandle, target, targetHandle });

  it("conecta e bloqueia duplicata na mesma saída", () => {
    const d1 = connect(d, c("start", "next", "a"));
    expect(d1.edges).toHaveLength(1);
    expect(connectionProblem(d1, c("start", "next", "z"))).toMatch(/já está conectada/);
    expect(connect(d1, c("start", "next", "z"))).toBe(d1);
  });
  it.each([
    ["auto-ligação", c("a", "next", "a"), /si mesmo/],
    ["saída inexistente", c("a", "foo", "z"), /Saída inexistente/],
    ["entrada inexistente", c("a", "next", "z", "foo"), /Entrada inexistente/],
    ["nó inexistente", c("a", "next", "fantasma"), /inexistente/],
    ["saindo de nó que não tem saída", c("z", "next", "a"), /Saída inexistente/],
  ])("bloqueia %s", (_n, conn, re) => {
    expect(connectionProblem(d, conn)).toMatch(re);
  });
  it("removeEdges", () => {
    const d1 = connect(d, c("start", "next", "a"));
    expect(removeEdges(d1, [d1.edges[0]!.id]).edges).toEqual([]);
    expect(removeEdges(d1, ["x"])).toBe(d1);
  });
  it("tudo que o editor permite conectar passa no validador", () => {
    let x = connect(d, c("start", "next", "a"));
    x = connect(x, c("a", "next", "z"));
    expect(hasErrors(validateWorkflow(x))).toBe(false);
  });
});

describe("duplicação", () => {
  it("copia nós e conexões internas, desloca posição e gera ids novos", () => {
    let d = addNode(addNode(base(), "flow.wait", at, "a"), "flow.end", at, "z");
    d = connect(d, { source: "a", sourceHandle: "next", target: "z", targetHandle: "input" });
    d = updateNodeConfig(d, "a", "seconds", 9);
    const { doc, newIds } = duplicateNodes(d, ["a", "z"]);
    expect(newIds).toHaveLength(2);
    expect(doc.nodes).toHaveLength(5);
    expect(doc.edges).toHaveLength(2);
    const copy = doc.nodes.find((n) => n.id === newIds[0])!;
    expect(copy.config["seconds"]).toBe(9);
    expect(doc.visual.positions[newIds[0]!]).toEqual({ x: 141, y: 90 });
    expect(doc.edges[1]!.source).toBe(newIds[0]);
    expect(doc.nodes.find((n) => n.id === "a")!.config).not.toBe(copy.config); // cópia, não referência
  });
  it("não duplica o início (tipo único)", () => {
    const d = base();
    const r = duplicateNodes(d, ["start"]);
    expect(r.doc).toBe(d);
    expect(r.newIds).toEqual([]);
  });
  it("conexão com nó fora da seleção não é copiada", () => {
    let d = addNode(addNode(base(), "flow.wait", at, "a"), "flow.end", at, "z");
    d = connect(d, { source: "a", sourceHandle: "next", target: "z", targetHandle: "input" });
    expect(duplicateNodes(d, ["a"]).doc.edges).toHaveLength(1);
  });
});

describe("variáveis", () => {
  it("adiciona com nome único e remove", () => {
    let d = addVariable(addVariable(base()));
    expect(Object.keys(d.variables)).toEqual(["variavel1", "variavel2"]);
    d = removeVariable(d, "variavel1");
    expect(Object.keys(d.variables)).toEqual(["variavel2"]);
    expect(addVariable(d).variables).toHaveProperty("variavel2");
    expect(removeVariable(d, "x")).toBe(d);
  });
  it("renomeia preservando a ordem e valida o nome", () => {
    const d = addVariable(addVariable(base()));
    const r = renameVariable(d, "variavel1", "pasta") as typeof d;
    expect(Object.keys(r.variables)).toEqual(["pasta", "variavel2"]);
    expect(renameVariable(d, "variavel1", "variavel2")).toMatch(/Já existe/);
    expect(renameVariable(d, "variavel1", "1x")).toMatch(/letras/);
    expect(renameVariable(d, "variavel1", "variavel1")).toBe(d);
  });
  it("setVariable e conversão de tipo", () => {
    const d = addVariable(base());
    const n = setVariable(d, "variavel1", { type: "number", value: 3 });
    expect(n.variables["variavel1"]).toEqual({ type: "number", value: 3 });
    expect(setVariable(n, "variavel1", { type: "number", value: 3 })).toBe(n);
    expect(convertVariableValue("12", "number")).toBe(12);
    expect(convertVariableValue("abc", "number")).toBe(0);
    expect(convertVariableValue("true", "boolean")).toBe(true);
    expect(convertVariableValue(5, "string")).toBe("5");
  });
});
