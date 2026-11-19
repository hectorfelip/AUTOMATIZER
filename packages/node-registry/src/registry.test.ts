import { describe, expect, it } from "vitest";
import { CATEGORIES, NODE_DEFINITIONS, defaultConfig, getNodeDefinition } from "./index.js";

describe("node registry", () => {
  it("tipos são únicos e estáveis", () => {
    const types = NODE_DEFINITIONS.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    for (const t of types) expect(t).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it.each(NODE_DEFINITIONS.map((d) => [d.type, d] as const))("%s: contrato consistente", (_t, d) => {
    expect(CATEGORIES.map((c) => c.id)).toContain(d.category);
    for (const list of [d.inputs, d.outputs]) {
      expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
    }
    expect(new Set(d.fields.map((f) => f.key)).size).toBe(d.fields.length);
    for (const f of d.fields) {
      if (f.kind === "select") expect(f.options?.length).toBeGreaterThan(0);
      if (f.min !== undefined && f.max !== undefined) expect(f.min).toBeLessThanOrEqual(f.max);
      if (f.pattern) expect(() => new RegExp(f.pattern!)).not.toThrow();
    }
  });

  it("resultados: chaves únicas, tipos válidos e listas de objetos declaram as propriedades do item", () => {
    for (const d of NODE_DEFINITIONS) {
      const keys = (d.results ?? []).map((x) => x.key);
      expect(new Set(keys).size, d.type).toBe(keys.length);
      for (const res of d.results ?? []) {
        expect(["string", "number", "boolean", "list", "object"]).toContain(res.type);
        expect(res.key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/); // usável em {{nodes.id.chave}}
        if (res.itemProps) expect(res.type).toBe("list");
      }
    }
    const files = getNodeDefinition("files.list")!.results!.find((x) => x.key === "files")!;
    expect(files).toMatchObject({ type: "list" });
    expect(files.itemProps).toEqual(expect.arrayContaining(["name", "stem", "extension", "path"]));
  });

  it("Para cada item: lista obrigatória, nome do item fixo e saídas corpo/depois", () => {
    const d = getNodeDefinition("flow.foreach")!;
    expect(d.outputs.map((o) => o.id)).toEqual(["body", "done"]);
    expect(d.fields.find((f) => f.key === "items")).toMatchObject({ kind: "list", required: true });
    const name = d.fields.find((f) => f.key === "itemName")!;
    expect(name).toMatchObject({ literal: true, default: "item" });
    const re = new RegExp(name.pattern!);
    expect(["item", "arquivo", "_x1"].every((n) => re.test(n))).toBe(true);
    expect(["variables", "nodes", "1x", "a-b", ""].some((n) => re.test(n))).toBe(false); // reservados e inválidos
    expect(defaultConfig(d)).toEqual({ itemName: "item" });
  });

  it("todo fluxo tem exatamente um tipo de início e ele é único", () => {
    expect(getNodeDefinition("trigger.manual")).toMatchObject({ unique: true, inputs: [] });
    expect(getNodeDefinition("flow.end")?.outputs).toEqual([]);
  });

  it("defaultConfig usa os padrões dos campos", () => {
    expect(defaultConfig(getNodeDefinition("flow.wait")!)).toEqual({ seconds: 1 });
    expect(defaultConfig(getNodeDefinition("files.move")!)).toEqual({ overwrite: false });
  });

  it("tipo desconhecido devolve undefined", () => {
    expect(getNodeDefinition("nope.nope")).toBeUndefined();
  });
});
