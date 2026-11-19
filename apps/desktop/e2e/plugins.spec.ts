import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeApp, edgeSpec as e, launch, newDataDir, nodeSpec as n, openEditor, seedFlow, waitEngineReady } from "./helpers";

const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name });
const stubOpen = (app: ElectronApplication, path: string | null) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: p === null, filePaths: p ? [p] : [] })) as never;
  }, path);

const innerFlow = () => ({
  schemaVersion: 1, id: "p", name: "interno",
  nodes: [
    { id: "start", type: "trigger.manual", version: 1, config: {} },
    { id: "s", type: "data.set_variable", version: 1, config: { name: "saudacao", value: "Olá, {{variables.nome}}!" } },
    { id: "end", type: "flow.end", version: 1, config: {} },
  ],
  edges: [
    { id: "e1", source: "start", sourceHandle: "next", target: "s", targetHandle: "input" },
    { id: "e2", source: "s", sourceHandle: "next", target: "end", targetHandle: "input" },
  ],
  variables: { nome: { type: "string", value: "mundo" }, saudacao: { type: "string", value: "" } },
  settings: { timeoutSeconds: 60, errorPolicy: "stop" }, visual: { positions: {} },
});
const PLUGIN = {
  format: "automation-studio.plugin", formatVersion: 1, id: "saudacao", name: "Montar saudação", version: "1.0.0",
  description: "Monta uma saudação com o nome informado.", fields: [{ key: "nome", label: "Nome", kind: "text" }], returns: ["saudacao"], flow: innerFlow(),
};
const file = (name: string, content: unknown) => {
  const p = join(mkdtempSync(join(tmpdir(), "as-e2e-plugin-")), name);
  writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content));
  return p;
};

async function install(app: ElectronApplication, page: Page, path: string) {
  await nav(page, "Plugins").click();
  await stubOpen(app, path);
  await page.getByRole("button", { name: "Instalar plugin…" }).click();
  const sum = page.getByTestId("plugin-summary");
  await expect(sum).toContainText("Montar saudação (v1.0.0)");
  await expect(sum).toContainText("plugin.saudacao");
  await page.getByRole("button", { name: "Instalar", exact: true }).click();
  await expect(page.getByTestId("plugin-notice")).toContainText("instalado");
}

test("instalar plugin: nó na paleta, usar num fluxo, executar e ver os passos internos", async () => {
  const { app, page } = await launch(newDataDir());
  await install(app, page, file("saudacao.asplugin.json", PLUGIN));
  await expect(page.getByTestId("plugin-saudacao")).toContainText("Ativo");

  await seedFlow(page, "Usa plugin", {
    nodes: [
      n("start", "trigger.manual"),
      n("pl", "plugin.saudacao", { nome: "Hector" }),
      n("guarda", "data.set_variable", { name: "r", value: "{{nodes.pl.saudacao}}" }),
      n("end", "flow.end"),
    ],
    edges: [e("start", "next", "pl"), e("pl", "success", "guarda"), e("guarda", "next", "end")],
    variables: { r: { type: "string", value: "" } },
  });
  await waitEngineReady(page);
  await openEditor(page, "Usa plugin");
  await expect(page.getByRole("region", { name: "Plugins" }).getByRole("button", { name: /Montar saudação/ })).toBeVisible(); // na paleta
  await page.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(page.getByTestId("run-status")).toContainText("Execução concluída", { timeout: 15_000 });
  await expect(page.getByTestId("snap-var-r")).toContainText("Olá, Hector!");
  await expect(page.getByTestId("run-row-pl/s")).toContainText("Montar saudação › Definir variável");
  await closeApp(app);
});

test("desativar tira o nó (o fluxo deixa de ser executável); reativar e reiniciar o app preservam", async () => {
  const dir = newDataDir();
  let a = await launch(dir);
  await install(a.app, a.page, file("p.json", PLUGIN));
  await seedFlow(a.page, "Usa", {
    nodes: [n("start", "trigger.manual"), n("pl", "plugin.saudacao", {}), n("end", "flow.end")],
    edges: [e("start", "next", "pl"), e("pl", "success", "end")],
  });
  await nav(a.page, "Plugins").click();
  await a.page.getByRole("button", { name: "Desativar plugin Montar saudação" }).click();
  await expect(a.page.getByTestId("plugin-saudacao")).toContainText("Desativado");
  await nav(a.page, "Automações").click();
  await a.page.getByRole("button", { name: "Abrir Usa" }).click();
  await expect(a.page.getByTestId("validation-summary")).toContainText("erro");
  await expect(a.page.getByRole("button", { name: "Executar", exact: true })).toBeDisabled();
  await a.page.getByRole("button", { name: "← Automações" }).click();
  await nav(a.page, "Plugins").click();
  await a.page.getByRole("button", { name: "Ativar plugin Montar saudação" }).click();
  await closeApp(a.app);

  a = await launch(dir); // reinício: continua instalado e ativo
  await nav(a.page, "Plugins").click();
  await expect(a.page.getByTestId("plugin-saudacao")).toContainText("Ativo");
  await expect(a.page.getByTestId("plugin-saudacao")).toContainText("usado em 1 automação");
  await nav(a.page, "Automações").click();
  await a.page.getByRole("button", { name: "Abrir Usa" }).click();
  await expect(a.page.getByTestId("validation-summary")).toContainText("Fluxo válido");

  // remover avisa quem usa
  await a.page.getByRole("button", { name: "← Automações" }).click();
  await nav(a.page, "Plugins").click();
  await a.page.getByRole("button", { name: "Remover plugin Montar saudação" }).click();
  await expect(a.page.getByRole("dialog", { name: "Remover plugin" })).toContainText("usado em 1 automação");
  await a.page.getByRole("dialog", { name: "Remover plugin" }).getByRole("button", { name: "Remover" }).click();
  await expect(a.page.getByText("Nenhum plugin instalado.")).toBeVisible();
  await closeApp(a.app);
});

test("plugins inválidos ou perigosos são recusados sem instalar nada", async () => {
  const { app, page } = await launch(newDataDir());
  await nav(page, "Plugins").click();
  const bad = (code: unknown) => file("x.json", code);
  const withNode = (type: string) => ({ ...PLUGIN, flow: { ...innerFlow(), nodes: [...innerFlow().nodes, { id: "x", type, version: 1, config: {} }] } });
  for (const [p, msg] of [
    [bad("{isso não é json"), "não é um JSON válido"],
    [bad({ format: "outro" }), "não parece um plugin"],
    [bad({ ...PLUGIN, formatVersion: 9 }), "Versão de plugin 9 não suportada"],
    [bad({ ...PLUGIN, codigo: "import os; os.system('calc')" }), "Plugin inválido"],
    [bad(withNode("os.system")), "não é um nó embutido"],
    [bad(withNode("flow.subflow")), "Chamar fluxo"],
    [bad({ ...PLUGIN, id: "../etc" }), "id deve ter"],
  ] as const) {
    await stubOpen(app, p);
    await page.getByRole("button", { name: "Instalar plugin…" }).click();
    await expect(page.getByRole("alert").filter({ hasText: msg })).toBeVisible();
    await expect(page.getByTestId("plugin-summary")).toHaveCount(0);
  }
  await stubOpen(app, null); // cancelar
  await page.getByRole("button", { name: "Instalar plugin…" }).click();
  await expect(page.getByTestId("plugin-summary")).toHaveCount(0);
  expect(await page.evaluate(async () => { const r = await window.api.plugins.list(); return r.ok ? r.data.length : -1; })).toBe(0);
  await closeApp(app);
});
