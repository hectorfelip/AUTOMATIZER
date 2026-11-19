// Roda os exemplos pelo pipeline REAL: interpretador → EngineClient → motor Python → disco.
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@automation-studio/shared-types";
import { runWorkflow, type ActionExecutor } from "@automation-studio/workflow-interpreter";
import type { WorkflowDocument } from "@automation-studio/workflow-schema";
import { EngineClient } from "./engine/client.js";
import { resolveEngineLaunch } from "./engine/launch.js";
import { templates } from "./templates.js";

const repoRoot = resolve(import.meta.dirname, "../../../../..");
let engine: EngineClient;
const executor: ActionExecutor = {
  execute: (req, { signal, onProgress }) => {
    const p = engine.executeAction(req, onProgress);
    signal.addEventListener("abort", () => engine.cancel(req.executionId), { once: true });
    return p;
  },
};

beforeAll(async () => {
  engine = new EngineClient({ launch: () => resolveEngineLaunch({ platform: process.platform, env: process.env, isPackaged: false, resourcesPath: "", repoRoot }) });
  engine.start();
  for (let i = 0; i < 300 && engine.status.state !== "ready"; i++) await new Promise((r) => setTimeout(r, 20));
  expect(engine.status.state).toBe("ready");
});
afterAll(() => engine.stop());

const tmp = () => mkdtempSync(join(tmpdir(), "as-tpl-"));
const names = (dir: string) => readdirSync(dir).sort();
/** Copia o exemplo trocando variáveis (os valores originais usam %USERPROFILE%, que só existe no Windows). */
function withVars(id: string, vars: Record<string, string | number>, tweak?: (d: WorkflowDocument) => void): WorkflowDocument {
  const d = structuredClone(templates.find((t) => t.id === id)!.workflow);
  for (const [k, v] of Object.entries(vars)) d.variables[k] = { type: typeof v === "number" ? "number" : "string", value: v };
  // Os exemplos usam separador do Windows (\\): em outros sistemas, troca pelo separador local.
  if (sep !== "\\") for (const n of d.nodes) for (const [k, v] of Object.entries(n.config)) if (typeof v === "string") n.config[k] = v.replaceAll("\\", sep);
  tweak?.(d);
  return d;
}
const run = async (doc: WorkflowDocument) => {
  const events: ExecutionEvent[] = [];
  const result = await runWorkflow(doc, { executionId: "t", executor, onEvent: (e) => events.push(e) });
  return { result, events };
};

describe("exemplos rodando de verdade", () => {
  it("Organizar PDFs: cria a pasta de destino e move só os PDFs", async () => {
    const base = tmp();
    const origem = join(base, "Downloads");
    mkdirSync(origem);
    for (const f of ["a.pdf", "b.pdf", "nota.txt", "foto.png"]) writeFileSync(join(origem, f), f);
    const destino = join(base, "Documentos", "PDFs"); // não existe ainda

    const { result, events } = await run(withVars("organizar-pdfs", { origem, destino }));
    expect(result.status).toBe("completed");
    expect(names(destino)).toEqual(["a.pdf", "b.pdf"]);
    expect(names(origem)).toEqual(["foto.png", "nota.txt"]); // o resto ficou
    expect(events.find((e) => e.type === "node_completed" && e.nodeId === "mover")).toMatchObject({ message: expect.stringContaining("2 arquivo(s)") });
  });

  it("Organizar PDFs: sem PDFs não é erro, só informa", async () => {
    const base = tmp();
    const origem = join(base, "vazio");
    mkdirSync(origem);
    const { result, events } = await run(withVars("organizar-pdfs", { origem, destino: join(base, "PDFs") }));
    expect(result).toMatchObject({ status: "completed" }); // (o objeto inteiro aparece no diff se falhar)
    expect(events.find((e) => e.type === "node_completed" && e.nodeId === "mover")).toMatchObject({ message: expect.stringContaining("Nenhum arquivo corresponde") });
  });

  it("Organizar PDFs: pasta de origem inexistente falha apontando o nó e a causa", async () => {
    const base = tmp();
    const { result } = await run(withVars("organizar-pdfs", { origem: join(base, "nao-existe"), destino: join(base, "PDFs") }));
    expect(result).toMatchObject({ status: "failed", error: { code: "PATH_NOT_FOUND", message: expect.stringMatching(/^Mover arquivo: .*nao-existe/) } });
  });

  it("Organizar PDFs: conflito não sobrescreve e avisa, sem mover nada", async () => {
    const base = tmp();
    const origem = join(base, "in");
    const destino = join(base, "out");
    mkdirSync(origem);
    mkdirSync(destino);
    writeFileSync(join(origem, "a.pdf"), "novo");
    writeFileSync(join(destino, "a.pdf"), "antigo");
    const { result } = await run(withVars("organizar-pdfs", { origem, destino }));
    expect(result).toMatchObject({ status: "failed", error: { code: "DESTINATION_EXISTS", message: expect.stringContaining("Nada foi alterado") } });
    expect(names(origem)).toEqual(["a.pdf"]);
  });

  it("Backup condicional: pasta de backup nova → cria e copia; já existente → só copia", async () => {
    const base = tmp();
    const arquivo = join(base, "importante.docx");
    writeFileSync(arquivo, "dados");
    const novo = join(base, "Backup-novo");
    const existente = join(base, "Backup-existente");
    mkdirSync(existente);

    const a = await run(withVars("backup-condicional", { arquivo, pastaBackup: novo }));
    expect(a.result.status).toBe("completed");
    expect(a.events.some((e) => e.type === "node_started" && e.nodeId === "criar")).toBe(true); // caminho "não existe"
    expect(names(novo)).toEqual(["importante.docx"]);

    const b = await run(withVars("backup-condicional", { arquivo, pastaBackup: existente }));
    expect(b.result.status).toBe("completed");
    expect(b.events.some((e) => e.type === "node_started" && e.nodeId === "criar")).toBe(false); // caminho "existe"
    expect(names(existente)).toEqual(["importante.docx"]);
  });

  it("Repetir: o corpo roda o número de vezes pedido e depois segue", async () => {
    const { result, events } = await run(withVars("repetir-esperar", { voltas: 3 }, (d) => (d.nodes.find((n) => n.id === "esperar")!.config["seconds"] = 0)));
    expect(result.status).toBe("completed");
    expect(events.filter((e) => e.type === "node_completed" && e.nodeId === "esperar")).toHaveLength(3);
    expect((events.at(-1) as { message?: string }).message).toBe("Repetições concluídas");
  });

  it("Organizar por tipo: Para cada arquivo, cria a pasta da extensão e move para lá", async () => {
    const base = tmp();
    const origem = join(base, "Downloads");
    mkdirSync(origem);
    for (const f of ["a.pdf", "b.pdf", "nota.txt", "foto.JPG", "LEIAME"]) writeFileSync(join(origem, f), f);
    const destino = join(base, "Organizados");

    const { result, events } = await run(withVars("organizar-por-tipo", { origem, destino }));
    expect(result.status).toBe("completed");
    expect(names(join(destino, "pdf"))).toEqual(["a.pdf", "b.pdf"]);
    expect(names(join(destino, "txt"))).toEqual(["nota.txt"]);
    expect(names(join(destino, "jpg"))).toEqual(["foto.JPG"]); // extensão em minúsculas na pasta
    expect(readdirSync(destino).sort()).toEqual(["LEIAME", "jpg", "pdf", "txt"]); // sem extensão: direto em destino
    expect(readdirSync(origem)).toEqual([]); // tudo foi movido
    const passos = events.filter((e) => e.type === "node_completed" && e.nodeId === "cada").map((e) => (e as { message?: string }).message);
    expect(passos).toEqual(["Item 1 de 5.", "Item 2 de 5.", "Item 3 de 5.", "Item 4 de 5.", "Item 5 de 5.", "5 item(ns) processado(s)."]);
  });

  it("Organizar por tipo: pasta vazia não é erro", async () => {
    const base = tmp();
    const origem = join(base, "vazia");
    mkdirSync(origem);
    const { result, events } = await run(withVars("organizar-por-tipo", { origem, destino: join(base, "Org") }));
    expect(result.status).toBe("completed");
    expect(events.find((e) => e.type === "node_completed" && e.nodeId === "cada")).toMatchObject({ message: "A lista está vazia; nada a repetir." });
  });

  it("Organizar por tipo: um conflito no meio do laço para, aponta o nó e não sobrescreve", async () => {
    const base = tmp();
    const origem = join(base, "in");
    const destino = join(base, "out");
    mkdirSync(origem);
    mkdirSync(join(destino, "pdf"), { recursive: true });
    writeFileSync(join(origem, "a.pdf"), "novo-a");
    writeFileSync(join(origem, "b.pdf"), "novo-b");
    writeFileSync(join(destino, "pdf", "b.pdf"), "antigo-b"); // o 2º arquivo vai conflitar

    const { result } = await run(withVars("organizar-por-tipo", { origem, destino }));
    expect(result).toMatchObject({ status: "failed", error: { code: "DESTINATION_EXISTS", message: expect.stringMatching(/^Mover arquivo: .*já existem/) } });
    expect(names(join(destino, "pdf"))).toEqual(["a.pdf", "b.pdf"]); // a.pdf já tinha sido movido
    expect(names(origem)).toEqual(["b.pdf"]); // b.pdf ficou na origem, intacto
  });

  it("Backup somente se houver arquivos: usa a quantidade do 'Listar' para decidir", async () => {
    const base = tmp();
    const origem = join(base, "Docs");
    mkdirSync(origem);
    writeFileSync(join(origem, "a.docx"), "a");
    writeFileSync(join(origem, "b.docx"), "b");
    writeFileSync(join(origem, "c.txt"), "c");
    const backup = join(base, "Backup");
    const com = await run(withVars("backup-se-houver-arquivos", { origem, backup }));
    expect(com.result.status).toBe("completed");
    expect(names(backup)).toEqual(["a.docx", "b.docx"]);
    expect((com.events.at(-1) as { message?: string }).message).toBe("Backup concluído");

    const vazio = join(base, "SemDocx");
    mkdirSync(vazio);
    const sem = await run(withVars("backup-se-houver-arquivos", { origem: vazio, backup: join(base, "Backup2") }));
    expect(sem.result.status).toBe("completed");
    expect((sem.events.at(-1) as { message?: string }).message).toBe("Nenhum arquivo novo: nada a fazer");
    expect(readdirSync(base).includes("Backup2")).toBe(false); // nem criou a pasta
  });

  it("o exemplo de janela/teclado falha no Linux com mensagem clara (e não trava)", async () => {
    if (process.platform === "win32") return;
    const { result } = await run(withVars("bloco-de-notas", {}, (d) => (d.nodes.find((n) => n.id === "abrir")!.config["application"] = "sleep")));
    // abrir_app funciona (sleep sem argumentos sai logo); ativar janela não existe fora do Windows
    expect(result).toMatchObject({ status: "failed", error: { code: "UNSUPPORTED_PLATFORM" } });
  });
});
