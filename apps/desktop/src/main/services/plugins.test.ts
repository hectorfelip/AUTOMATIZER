import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getNodeDefinition, setPluginNodes } from "@automation-studio/node-registry";
import { createEmptyWorkflow } from "@automation-studio/workflow-schema";
import { openDatabase } from "../database/db.js";
import { createAutomationService } from "./automations.js";
import { createPluginService } from "./plugins.js";
import { createWorkflowService } from "./workflows.js";

const flow = (set = "Olá, {{variables.nome}}!") => {
  const d = createEmptyWorkflow("p", "interno");
  d.variables = { nome: { type: "string", value: "mundo" }, saudacao: { type: "string", value: "" } };
  d.nodes.push({ id: "s", type: "data.set_variable", version: 1, config: { name: "saudacao", value: set } }, { id: "end", type: "flow.end", version: 1, config: {} });
  d.edges.push({ id: "e1", source: "start", sourceHandle: "next", target: "s", targetHandle: "input" }, { id: "e2", source: "s", sourceHandle: "next", target: "end", targetHandle: "input" });
  return d;
};
const plugin = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ format: "automation-studio.plugin", formatVersion: 1, id: "saudacao", name: "Montar saudação", version: "1.0.0", description: "Monta uma saudação.", fields: [{ key: "nome", label: "Nome", kind: "text" }], returns: ["saudacao"], flow: flow(), ...over });

let files: Map<string, string>;
let open: string | null;
const io = {
  pickOpenPath: async () => open,
  statSize: (p: string) => Buffer.byteLength(files.get(p) ?? ""),
  readText: (p: string) => {
    if (!files.has(p)) throw new Error("ENOENT");
    return files.get(p)!;
  },
  baseName: (p: string) => p,
};
const setup = () => {
  const db = openDatabase(":memory:");
  let n = 0;
  return { db, svc: createPluginService(db, { io, newToken: () => `t${++n}` }) };
};
beforeEach(() => {
  files = new Map();
  open = "/p.json";
});
afterEach(() => setPluginNodes([]));

describe("serviço de plugins", () => {
  it("prévia resume e não instala; confirmar instala, ativa o nó e mostra na lista", async () => {
    const { svc } = setup();
    files.set("/p.json", plugin());
    const pv = (await svc.importPreview())!;
    expect(pv).toMatchObject({ token: "t1", id: "saudacao", name: "Montar saudação", version: "1.0.0", fieldCount: 1, returns: ["saudacao"], nodeType: "plugin.saudacao", replacesVersion: null });
    expect(svc.list()).toEqual([]);
    expect(getNodeDefinition("plugin.saudacao")).toBeUndefined(); // ainda não
    const s = svc.importConfirm(pv.token);
    expect(s).toMatchObject({ id: "saudacao", enabled: true, usedBy: 0, problem: null });
    expect(getNodeDefinition("plugin.saudacao")?.label).toBe("Montar saudação");
    expect(svc.sources().map((x) => x.id)).toEqual(["saudacao"]);
  });

  it("desativar tira o nó; ativar devolve; remover apaga; id inexistente → NOT_FOUND", async () => {
    const { svc } = setup();
    files.set("/p.json", plugin());
    svc.importConfirm((await svc.importPreview())!.token);
    expect(svc.setEnabled("saudacao", false).enabled).toBe(false);
    expect(getNodeDefinition("plugin.saudacao")).toBeUndefined();
    expect(svc.sources()).toEqual([]);
    svc.setEnabled("saudacao", true);
    expect(getNodeDefinition("plugin.saudacao")).toBeDefined();
    svc.remove("saudacao");
    expect(svc.list()).toEqual([]);
    expect(getNodeDefinition("plugin.saudacao")).toBeUndefined();
    expect(() => svc.remove("saudacao")).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() => svc.setEnabled("nada", true)).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("reinstalar o mesmo id substitui (mostra a versão anterior) e mantém desativado se estava", async () => {
    const { svc } = setup();
    files.set("/p.json", plugin());
    svc.importConfirm((await svc.importPreview())!.token);
    svc.setEnabled("saudacao", false);
    files.set("/p.json", plugin({ version: "1.1.0", name: "Saudação v2" }));
    const pv = (await svc.importPreview())!;
    expect(pv.replacesVersion).toBe("1.0.0");
    const s = svc.importConfirm(pv.token);
    expect(s).toMatchObject({ version: "1.1.0", name: "Saudação v2", enabled: false });
  });

  it("recusa arquivo inválido (nada é instalado) e plugin que tenta usar nó não embutido", async () => {
    const { svc } = setup();
    for (const [text, msg] of [["{ruim", /JSON válido/], ['{"format":"x"}', /não parece um plugin/], [plugin({ flow: { ...flow(), nodes: [...flow().nodes, { id: "x", type: "os.system", version: 1, config: {} }] } }), /não é um nó embutido/]] as const) {
      files.set("/p.json", text);
      await expect(svc.importPreview()).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringMatching(msg) });
    }
    expect(svc.list()).toEqual([]);
  });

  it("token de uso único, expira e nova prévia invalida a anterior; cancelar o diálogo é silencioso", async () => {
    const { svc } = setup();
    files.set("/p.json", plugin());
    const a = (await svc.importPreview())!;
    const b = (await svc.importPreview())!;
    expect(() => svc.importConfirm(a.token)).toThrow(/expirou/);
    svc.importConfirm(b.token);
    expect(() => svc.importConfirm(b.token)).toThrow(/expirou/);
    open = null;
    expect(await svc.importPreview()).toBeNull();
  });

  it("arquivo ilegível e arquivo gigante: mensagens claras", async () => {
    const { svc } = setup();
    open = "/nao-existe.json";
    await expect(svc.importPreview()).rejects.toMatchObject({ code: "IO_ERROR" });
    open = "/p.json";
    files.set("/p.json", " ".repeat(600 * 1024));
    await expect(svc.importPreview()).rejects.toThrow(/grande demais/);
  });

  it("apply ignora plugin corrompido no banco sem derrubar o app, e a lista avisa", () => {
    const { db, svc } = setup();
    db.prepare("INSERT INTO plugins (id, name, version, enabled, source_json, installed_at) VALUES ('quebrado', 'Q', '1.0.0', 1, '{lixo', 't')").run();
    expect(() => svc.apply()).not.toThrow();
    expect(svc.list()[0]).toMatchObject({ id: "quebrado", problem: expect.stringContaining("ignorado") });
  });

  it("usedBy conta as automações que usam o nó na versão salva atual", async () => {
    const { db, svc } = setup();
    files.set("/p.json", plugin());
    svc.importConfirm((await svc.importPreview())!.token);
    const autos = createAutomationService(db);
    const wf = createWorkflowService(db);
    const a = autos.create({ name: "Usa", description: "" });
    const d = createEmptyWorkflow(a.id, "Usa");
    d.nodes.push({ id: "pl", type: "plugin.saudacao", version: 1, config: {} }, { id: "end", type: "flow.end", version: 1, config: {} });
    d.edges.push({ id: "e1", source: "start", sourceHandle: "next", target: "pl", targetHandle: "input" }, { id: "e2", source: "pl", sourceHandle: "success", target: "end", targetHandle: "input" });
    wf.save(a.id, d);
    expect(svc.list()[0]!.usedBy).toBe(1);
  });
});
