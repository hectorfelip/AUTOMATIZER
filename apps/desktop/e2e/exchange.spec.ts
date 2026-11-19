import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeApp, edgeSpec as e, launch, newDataDir, nodeSpec as n, seedFlow } from "./helpers";

const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name });

/** O diálogo nativo não é automatizável: troca-se a função do Electron por uma que devolve o caminho de teste. */
const stubSave = (app: ElectronApplication, path: string | null) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({ canceled: p === null, filePath: p ?? undefined })) as never;
  }, path);
const stubOpen = (app: ElectronApplication, path: string | null) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: p === null, filePaths: p ? [p] : [] })) as never;
  }, path);

const flow = (page: Page, name: string) =>
  seedFlow(page, name, {
    nodes: [n("start", "trigger.manual"), n("w", "flow.wait", { seconds: 1 }), n("t", "input.type_text", { text: "olá" }), n("end", "flow.end", { message: "fim" })],
    edges: [e("start", "next", "w"), e("w", "next", "t"), e("t", "next", "end")],
    variables: { x: { type: "string", value: "valor" } },
  });
const executionCount = (page: Page) =>
  page.evaluate(async () => {
    const r = await window.api.history.list({});
    return r.ok ? r.data.total : -1;
  });

test("exportar numa instalação e importar em outra: resumo, nenhuma execução e fluxo idêntico", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "as-e2e-x-")), "meu-fluxo.json");

  // instalação A: exporta
  const a = await launch(newDataDir());
  await flow(a.page, "Fluxo A");
  await nav(a.page, "Automações").click();
  await stubSave(a.app, out);
  await a.page.getByRole("button", { name: "Exportar Fluxo A" }).click();
  await expect(a.page.getByTestId("exchange-notice")).toContainText("exportada para");
  const file = JSON.parse(readFileSync(out, "utf8"));
  expect(file).toMatchObject({ format: "automation-studio.workflow", formatVersion: 1, automation: { name: "Fluxo A" } });
  expect(file.workflow.nodes.map((x: { id: string }) => x.id)).toEqual(["start", "w", "t", "end"]);
  await closeApp(a.app);

  // instalação B (dados novos): importa
  const b = await launch(newDataDir());
  await nav(b.page, "Automações").click();
  await stubOpen(b.app, out);
  await b.page.getByRole("button", { name: "Importar…" }).click();
  const summary = b.page.getByTestId("import-summary");
  await expect(summary).toContainText("meu-fluxo.json");
  await expect(summary).toContainText("4 nó(s), 3 conexão(ões), 1 variável(is)");
  await expect(b.page.getByRole("list", { name: "Nós usados" })).toContainText("Digitar texto");
  await expect(b.page.getByText("só funcionam no Windows")).toBeVisible();
  await expect(b.page.getByText("Fluxo A", { exact: true })).toHaveCount(0); // ainda não foi criada
  await b.page.getByLabel("Nome da automação").fill("Importado");
  await b.page.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(b.page.getByTestId("exchange-notice")).toContainText("não foi executada");
  await expect(b.page.getByText("Importado", { exact: true })).toBeVisible();

  // abre: mesmos nós e variável; nada rodou
  await b.page.getByRole("button", { name: "Abrir Importado" }).click();
  await expect(b.page.locator(".react-flow__node")).toHaveCount(4);
  await b.page.getByRole("tab", { name: "Variáveis" }).click();
  await expect(b.page.getByLabel("Nome da variável x")).toBeVisible();
  expect(await executionCount(b.page)).toBe(0);
  await closeApp(b.app);
});

test("importar rejeita arquivo inválido ou de versão futura, sem criar nada; cancelar o diálogo é silencioso", async () => {
  const dir = mkdtempSync(join(tmpdir(), "as-e2e-bad-"));
  const bad = (name: string, text: string) => {
    const p = join(dir, name);
    writeFileSync(p, text);
    return p;
  };
  const { app, page } = await launch(newDataDir());
  await nav(page, "Automações").click();

  for (const [file, msg] of [
    [bad("a.json", "{isso não é json"), "não é um JSON válido"],
    [bad("b.json", '{"nome":"outro programa"}'), "não parece um fluxo"],
    [bad("c.json", JSON.stringify({ format: "automation-studio.workflow", formatVersion: 99 })), "Versão de arquivo 99 não suportada"],
  ] as const) {
    await stubOpen(app, file);
    await page.getByRole("button", { name: "Importar…" }).click();
    await expect(page.getByRole("alert").filter({ hasText: msg })).toBeVisible();
    await expect(page.getByTestId("import-summary")).toHaveCount(0);
  }
  await stubOpen(app, null); // cancelar
  await page.getByRole("button", { name: "Importar…" }).click();
  await expect(page.getByTestId("import-summary")).toHaveCount(0);
  const total = await page.evaluate(async () => {
    const r = await window.api.automations.list();
    return r.ok ? r.data.length : -1;
  });
  expect(total).toBe(0);
  await closeApp(app);
});

test("exportar fluxo nunca salvo pede para salvar; cancelar o 'Salvar como' não grava nada", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "as-e2e-y-")), "x.json");
  const { app, page } = await launch(newDataDir());
  await nav(page, "Automações").click();
  await page.getByRole("button", { name: "Nova automação" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Vazio");
  await page.getByRole("button", { name: "Criar" }).click();
  await stubSave(app, out);
  await page.getByRole("button", { name: "Exportar Vazio" }).click();
  await expect(page.getByRole("alert")).toContainText("ainda não foi salvo");

  await flow(page, "Salvo");
  await nav(page, "Automações").click();
  await stubSave(app, null); // usuário cancela
  await page.getByRole("button", { name: "Exportar Salvo" }).click();
  await expect(page.getByTestId("exchange-notice")).toHaveCount(0);
  expect(() => readFileSync(out)).toThrow();
  await closeApp(app);
});
