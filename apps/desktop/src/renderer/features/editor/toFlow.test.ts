import { describe, expect, it } from "vitest";
import { createEmptyWorkflow } from "@automation-studio/workflow-schema";
import { validateWorkflow } from "@automation-studio/workflow-validator";
import { addNode, connect, updateNodeConfig } from "./docOps";
import { toFlow } from "./toFlow";

describe("toFlow", () => {
  const e = new Set<string>();
  it("posições vêm da seção visual; override (arraste) tem prioridade", () => {
    const d = createEmptyWorkflow("f", "T");
    expect(toFlow(d, [], e, e).nodes[0]!.position).toEqual({ x: 80, y: 120 });
    expect(toFlow(d, [], e, e, { start: { x: 1, y: 2 } }).nodes[0]!.position).toEqual({ x: 1, y: 2 });
  });
  it("marca seleção, mede e conta problemas por nó", () => {
    let d = addNode(createEmptyWorkflow("f", "T"), "files.move", { x: 0, y: 0 }, "mv");
    d = connect(d, { source: "start", sourceHandle: "next", target: "mv", targetHandle: "input" });
    const { nodes, edges } = toFlow(d, validateWorkflow(d), new Set(["mv"]), e, {}, { mv: { width: 100, height: 40 } });
    const mv = nodes.find((n) => n.id === "mv")!;
    expect(mv.selected).toBe(true);
    expect(mv.measured).toEqual({ width: 100, height: 40 });
    expect(mv.data.errors).toBe(2); // origem e destino obrigatórios
    expect(mv.data.outputs.map((p) => p.id)).toEqual(["success", "error"]);
    expect(edges).toHaveLength(1);
  });
  it("resumo mostra o primeiro parâmetro preenchido", () => {
    let d = addNode(createEmptyWorkflow("f", "T"), "files.list", { x: 0, y: 0 }, "l");
    expect(toFlow(d, [], e, e).nodes[1]!.data.summary).toBe("*"); // padrão do filtro
    d = updateNodeConfig(d, "l", "path", "C:\\Downloads");
    expect(toFlow(d, [], e, e).nodes[1]!.data.summary).toBe("C:\\Downloads");
  });
  it("tipo desconhecido não quebra", () => {
    const d = createEmptyWorkflow("f", "T");
    d.nodes.push({ id: "x", type: "foo.bar", version: 1, config: {} });
    const n = toFlow(d, [], e, e).nodes[1]!;
    expect(n.data.unknown).toBe(true);
    expect(n.data.label).toContain("foo.bar");
  });
});
