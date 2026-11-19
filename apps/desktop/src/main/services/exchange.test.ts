import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkflow } from "@automation-studio/workflow-schema";
import { openDatabase } from "../database/db.js";
import { createAutomationService } from "./automations.js";
import { createExchangeService, type ExchangeIO } from "./exchange.js";
import { createWorkflowService } from "./workflows.js";

let files: Map<string, string>;
let savePath: string | null;
let openPath: string | null;
let ioFail: boolean;
const io: ExchangeIO = {
  pickSavePath: async () => savePath,
  pickOpenPath: async () => openPath,
  statSize: (p) => Buffer.byteLength(files.get(p) ?? ""),
  readText: (p) => {
    if (ioFail || !files.has(p)) throw new Error("EACCES");
    return files.get(p)!;
  },
  writeText: (p, t) => {
    if (ioFail) throw new Error("EACCES");
    files.set(p, t);
  },
  baseName: (p) => p.split("/").pop()!,
};

function setup() {
  const db = openDatabase(":memory:");
  const automations = createAutomationService(db);
  const workflows = createWorkflowService(db);
  let n = 0;
  const exchange = createExchangeService({ automations, workflows, io, appVersion: "9.9.9", newToken: () => `tok-${++n}` });
  return { db, automations, workflows, exchange };
}
const savedFlow = (s: ReturnType<typeof setup>, name = "Original") => {
  const a = s.automations.create({ name, description: "descrição" });
  const d = createEmptyWorkflow(a.id, name);
  d.nodes.push({ id: "w", type: "flow.wait", version: 1, config: { seconds: 2 } });
  d.nodes.push({ id: "k", type: "input.hotkey", version: 1, config: { keys: "ctrl+c" } });
  d.edges.push({ id: "e", source: "start", sourceHandle: "next", target: "w", targetHandle: "input" });
  d.variables["x"] = { type: "string", value: "oi" };
  s.workflows.save(a.id, d);
  return a;
};

beforeEach(() => {
  files = new Map();
  savePath = "/out/f.json";
  openPath = "/in/f.json";
  ioFail = false;
});

describe("exportar", () => {
  it("grava a versão salva com metadados e sem o rascunho", async () => {
    const s = setup();
    const a = savedFlow(s);
    expect(await s.exchange.exportWorkflow(a.id)).toEqual({ path: "/out/f.json" });
    const file = JSON.parse(files.get("/out/f.json")!);
    expect(file).toMatchObject({ format: "automation-studio.workflow", formatVersion: 1, appVersion: "9.9.9", automation: { name: "Original", description: "descrição" } });
    expect(file.workflow.nodes.map((n: { id: string }) => n.id)).toEqual(["start", "w", "k"]);
  });

  it("cancelar o diálogo não grava nada e não é erro", async () => {
    const s = setup();
    const a = savedFlow(s);
    savePath = null;
    expect(await s.exchange.exportWorkflow(a.id)).toBeNull();
    expect(files.size).toBe(0);
  });

  it("fluxo nunca salvo: pede para salvar; id inexistente: NOT_FOUND; erro de disco: mensagem clara", async () => {
    const s = setup();
    const novo = s.automations.create({ name: "Vazio", description: "" });
    await expect(s.exchange.exportWorkflow(novo.id)).rejects.toThrow(/ainda não foi salvo/);
    await expect(s.exchange.exportWorkflow("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const a = savedFlow(s);
    ioFail = true;
    await expect(s.exchange.exportWorkflow(a.id)).rejects.toMatchObject({ code: "IO_ERROR", message: expect.stringContaining("permissões") });
  });

  it("nome com caracteres inválidos vira nome de arquivo seguro sugerido", async () => {
    const s = setup();
    const a = savedFlow(s, 'a/b:c*"d');
    let suggested = "";
    io.pickSavePath = async (n) => ((suggested = n), null);
    await s.exchange.exportWorkflow(a.id);
    expect(suggested).toBe("a_b_c__d.automation.json");
    io.pickSavePath = async () => savePath;
  });
});

describe("importar (outra instalação)", () => {
  async function exported() {
    const a = setup();
    const auto = savedFlow(a);
    await a.exchange.exportWorkflow(auto.id);
    return files.get("/out/f.json")!;
  }

  it("prévia resume o conteúdo e NÃO cria nada", async () => {
    const text = await exported();
    files.set("/in/f.json", text);
    const b = setup(); // "outra instalação": banco vazio
    const p = (await b.exchange.importPreview())!;
    expect(p).toMatchObject({
      token: "tok-1", fileName: "f.json", name: "Original", description: "descrição", appVersion: "9.9.9",
      nodeCount: 3, edgeCount: 1, variableCount: 1, errorPolicy: "stop", windowsOnly: true,
    });
    expect(p.nodes.map((n) => n.label).sort()).toEqual(["Atalho de teclado", "Esperar", "Início manual"]);
    expect(p.issues.errors).toBeGreaterThanOrEqual(0);
    expect(b.automations.list()).toHaveLength(0);
  });

  it("confirmar cria a automação com NOVO id, versão 1 e o mesmo conteúdo — sem executar", async () => {
    files.set("/in/f.json", await exported());
    const b = setup();
    const p = (await b.exchange.importPreview())!;
    const created = b.exchange.importConfirm(p.token);
    expect(created).toMatchObject({ name: "Original", status: "active" });
    const { document, version } = b.workflows.load(created.id);
    expect(version).toBe(1);
    expect(document.id).toBe(created.id);
    expect(document.nodes.map((n) => n.id)).toEqual(["start", "w", "k"]);
    expect(document.variables["x"]).toEqual({ type: "string", value: "oi" });
    const runs = b.db.prepare("SELECT COUNT(*) AS n FROM executions").get() as { n: number };
    expect(runs.n).toBe(0); // importar nunca executa
  });

  it("permite renomear na confirmação; token só vale uma vez e expira", async () => {
    files.set("/in/f.json", await exported());
    const b = setup();
    const p = (await b.exchange.importPreview())!;
    expect(b.exchange.importConfirm(p.token, "Outro nome").name).toBe("Outro nome");
    expect(() => b.exchange.importConfirm(p.token)).toThrow(/expirou|concluída/);
    expect(() => b.exchange.importConfirm("inventado")).toThrow(/expirou|concluída/);
    expect(b.automations.list()).toHaveLength(1);
  });

  it("nova prévia invalida a anterior (uma importação pendente por vez)", async () => {
    files.set("/in/f.json", await exported());
    const b = setup();
    const p1 = (await b.exchange.importPreview())!;
    await b.exchange.importPreview();
    expect(() => b.exchange.importConfirm(p1.token)).toThrow(/expirou/);
  });

  it("prévia expira com o tempo", async () => {
    files.set("/in/f.json", await exported());
    const a = setup();
    let t = 0;
    const ex = createExchangeService({ automations: a.automations, workflows: a.workflows, io, appVersion: "1", newToken: () => "t", ttlMs: 1000, now: () => t });
    const p = (await ex.importPreview())!;
    t = 5000;
    expect(() => ex.importConfirm(p.token)).toThrow(/expirou/);
  });

  it("cancelar o diálogo: nada acontece", async () => {
    openPath = null;
    expect(await setup().exchange.importPreview()).toBeNull();
  });

  it.each<[string, string, RegExp]>([
    ["não é JSON", "{ruim", /JSON válido/],
    ["JSON de outro programa", '{"name":"x"}', /não parece/],
    ["versão de arquivo futura", JSON.stringify({ format: "automation-studio.workflow", formatVersion: 2 }), /não suportada/],
  ])("rejeita arquivo inválido (%s) sem criar nada", async (_n, text, msg) => {
    files.set("/in/f.json", text);
    const b = setup();
    await expect(b.exchange.importPreview()).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringMatching(msg) });
    expect(b.automations.list()).toHaveLength(0);
  });

  it("arquivo ausente/sem permissão e arquivo gigante: mensagens claras", async () => {
    const b = setup();
    await expect(b.exchange.importPreview()).rejects.toMatchObject({ code: "IO_ERROR" });
    files.set("/in/f.json", " ".repeat(6 * 1024 * 1024));
    await expect(b.exchange.importPreview()).rejects.toThrow(/grande demais/);
  });

  it("fluxo com erros semânticos pode ser importado, mas a prévia avisa", async () => {
    const text = JSON.parse(await exported());
    text.workflow.nodes.push({ id: "z", type: "tipo.inexistente", version: 1, config: {} });
    files.set("/in/f.json", JSON.stringify(text));
    const p = (await setup().exchange.importPreview())!;
    expect(p.issues.errors).toBeGreaterThan(0);
    expect(p.nodes.some((n) => n.label.includes("Desconhecido"))).toBe(true);
  });

  it("nome vazio no arquivo cai no nome do fluxo ou no padrão", async () => {
    const text = JSON.parse(await exported());
    text.automation.name = "   ";
    text.workflow.name = "";
    files.set("/in/f.json", JSON.stringify(text));
    const b = setup();
    const p = (await b.exchange.importPreview())!;
    expect(p.name).toBe("Fluxo importado");
    expect(b.exchange.importConfirm(p.token).name).toBe("Fluxo importado");
  });
});
