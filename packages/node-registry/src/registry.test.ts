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
