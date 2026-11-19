import { describe, expect, it } from "vitest";
import { buildExport, parseExchange, EXCHANGE_FORMAT, MAX_IMPORT_BYTES } from "./exchange.js";
import { createEmptyWorkflow } from "./factory.js";

const doc = () => {
  const d = createEmptyWorkflow("abc", "Meu fluxo");
  d.variables["x"] = { type: "number", value: 3 };
  return d;
};
const exported = () => buildExport({ name: "Meu fluxo", description: "desc", workflow: doc(), appVersion: "1.2.3", now: new Date("2026-01-01T00:00:00Z") });
const mutate = (fn: (o: Record<string, unknown>) => void) => {
  const o = JSON.parse(exported()) as Record<string, unknown>;
  fn(o);
  return JSON.stringify(o);
};

describe("exportação/importação (envelope)", () => {
  it("ida e volta preserva o fluxo e os metadados", () => {
    const r = parseExchange(exported());
    expect(r).toMatchObject({ ok: true, file: { format: EXCHANGE_FORMAT, formatVersion: 1, appVersion: "1.2.3", exportedAt: "2026-01-01T00:00:00.000Z", automation: { name: "Meu fluxo", description: "desc" } } });
    if (r.ok) expect(r.file.workflow).toEqual(doc());
  });

  it("aceita BOM no início do arquivo", () => {
    expect(parseExchange("﻿" + exported()).ok).toBe(true);
  });

  it.each<[string, string, RegExp]>([
    ["não é JSON", "{quebrado", /JSON válido/],
    ["JSON de outro tipo", "[1,2]", /não parece/],
    ["objeto qualquer", '{"a":1}', /não parece/],
    ["formato errado", mutate((o) => (o["format"] = "outro")), /não parece/],
    ["versão do envelope desconhecida", mutate((o) => (o["formatVersion"] = 99)), /Versão de arquivo 99 não suportada/],
    ["campo extra no envelope", mutate((o) => (o["extra"] = 1)), /inválido/],
    ["metadados ausentes", mutate((o) => delete o["automation"]), /inválido/],
    ["schemaVersion do fluxo desconhecido", mutate((o) => ((o["workflow"] as Record<string, unknown>)["schemaVersion"] = 7)), /Versão de schema 7 não suportada/],
    ["fluxo malformado", mutate((o) => ((o["workflow"] as Record<string, unknown>)["nodes"] = "x")), /inválido/],
    ["campo extra no nó", mutate((o) => ((o["workflow"] as { nodes: Record<string, unknown>[] }).nodes[0]!["exec"] = "rm -rf")), /inválido/],
  ])("rejeita: %s", (_n, text, msg) => {
    const r = parseExchange(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(msg);
  });

  it("rejeita arquivo grande demais sem tentar interpretá-lo", () => {
    const r = parseExchange(" ".repeat(MAX_IMPORT_BYTES + 1));
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("grande demais") });
  });

  it("ataques de protótipo no JSON não contaminam objetos", () => {
    const text = exported().replace('"variables": {', '"variables": {\n"__proto__": {"type":"string","value":"x"},');
    parseExchange(text);
    expect(({} as Record<string, unknown>)["type"]).toBeUndefined();
  });
});
