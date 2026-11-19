import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeApp, edgeSpec as e, launch, newDataDir, nodeSpec as n, node, openEditor, seedFlow, seedWaitFlow, waitEngineReady } from "./helpers";

const runStatus = (page: Page) => page.getByTestId("run-status");
const btn = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name });
const open = async (page: Page, name: string) => {
  await waitEngineReady(page);
  await openEditor(page, name);
};

/** Fluxo Início → Definir variável (x=1) → Esperar(1s) → Fim. */
const vars = (page: Page, name: string) =>
  seedFlow(page, name, {
    nodes: [n("start", "trigger.manual"), n("set", "data.set_variable", { name: "x", value: "42" }), n("w", "flow.wait", { seconds: 1 }), n("end", "flow.end", { message: "ok" })],
    edges: [e("start", "next", "set"), e("set", "next", "w"), e("w", "next", "end")],
    variables: { x: { type: "number", value: 0 } },
  });

test("passo a passo: pausa antes de cada nó, mostra o nó e as variáveis, e termina", async () => {
  const { app, page } = await launch(newDataDir());
  await vars(page, "Passos");
  await open(page, "Passos");

  await btn(page, "Passo a passo").click();
  await expect(runStatus(page)).toContainText("Pausada antes de “Início manual”");
  await expect(node(page, "Início manual").getByTestId("node-state-start")).toHaveText("Pausado aqui");
  await expect(page.getByTestId("snap-var-x")).toContainText("0"); // valor declarado no fluxo

  await btn(page, "Próximo passo").click(); // executa o início
  await expect(runStatus(page)).toContainText("Pausada antes de “Definir variável”");
  await btn(page, "Próximo passo").click(); // executa Definir variável
  await expect(runStatus(page)).toContainText("Pausada antes de “Esperar”");
  await expect(page.getByTestId("snap-var-x")).toContainText("42"); // mudou depois do nó rodar
  await expect(node(page, "Definir variável").getByTestId("node-state-set")).toHaveText("Concluído");

  await btn(page, "Continuar").click();
  await expect(runStatus(page)).toContainText("Execução concluída em", { timeout: 10_000 });
  await expect(btn(page, "Executar")).toBeEnabled();
  await closeApp(app);
});

test("breakpoint: pausa antes do nó, persiste ao reabrir e F9 alterna no nó selecionado", async () => {
  const { app, page } = await launch(newDataDir());
  await vars(page, "Break");
  await open(page, "Break");

  await page.getByRole("button", { name: "Adicionar breakpoint em Esperar" }).click();
  await expect(page.getByRole("button", { name: "Remover breakpoint em Esperar" })).toHaveAttribute("aria-pressed", "true");
  await btn(page, "Executar").click();
  await expect(runStatus(page)).toContainText("Pausada antes de “Esperar” (breakpoint)");
  await expect(page.getByTestId("snap-var-x")).toContainText("42");
  await btn(page, "Cancelar").click();
  await expect(runStatus(page)).toContainText("Execução cancelada");

  // sai e volta: o breakpoint continua (é do usuário, guardado localmente)
  await nav(page, "Automações").click();
  await page.getByRole("button", { name: "Abrir Break" }).click();
  await expect(page.getByRole("button", { name: "Remover breakpoint em Esperar" })).toBeVisible();

  // F9 no nó selecionado remove
  await node(page, "Esperar").click();
  await page.keyboard.press("F9");
  await expect(page.getByRole("button", { name: "Adicionar breakpoint em Esperar" })).toBeVisible();
  await btn(page, "Executar").click();
  await expect(runStatus(page)).toContainText("Execução concluída em", { timeout: 10_000 });
  await closeApp(app);
});

test("pausar durante a execução vale ao fim do nó atual; continuar conclui", async () => {
  const { app, page } = await launch(newDataDir());
  await seedWaitFlow(page, "Pausa", 2);
  await open(page, "Pausa");

  await btn(page, "Executar").click();
  await expect(page.getByTestId("run-row-w")).toContainText("Executando…");
  await btn(page, "Pausar").click();
  await expect(page.getByTestId("run-current")).toContainText("pausa pedida");
  await expect(runStatus(page)).toContainText("Pausada antes de “Fim” (pedido de pausa)", { timeout: 6000 });
  await expect(page.getByTestId("run-row-w")).toContainText("Concluído"); // o nó em andamento terminou, não foi interrompido
  await btn(page, "Continuar").click();
  await expect(runStatus(page)).toContainText("Execução concluída em", { timeout: 6000 });
  await closeApp(app);
});

test("executar a partir daqui: pula os nós anteriores e aceita valores iniciais de variáveis", async () => {
  const { app, page } = await launch(newDataDir());
  await vars(page, "Daqui");
  await open(page, "Daqui");

  await node(page, "Esperar").click();
  await btn(page, "Executar a partir daqui").click();
  const dlg = page.getByRole("dialog", { name: /Executar a partir de “Esperar”/ });
  await dlg.getByLabel("Valor inicial de x").fill("7");
  await dlg.getByRole("button", { name: "Executar a partir daqui" }).click();

  await expect(runStatus(page)).toContainText("Execução concluída em", { timeout: 10_000 });
  await expect(page.getByTestId("run-row-w")).toContainText("Concluído");
  await expect(page.getByTestId("run-row-start")).toHaveCount(0); // não rodou
  await expect(page.getByTestId("run-row-set")).toHaveCount(0);
  await expect(page.getByTestId("snap-var-x")).toContainText("7"); // valor inicial aplicado
  await closeApp(app);
});

/** Mover com conflito de destino: falha de forma previsível, sem tocar nos arquivos. */
function conflict() {
  const base = mkdtempSync(join(tmpdir(), "as-e2e-dbg-"));
  const origem = join(base, "in");
  const destino = join(base, "out");
  mkdirSync(origem);
  mkdirSync(destino);
  writeFileSync(join(origem, "a.pdf"), "novo");
  writeFileSync(join(destino, "a.pdf"), "antigo");
  return { origem, destino };
}
const conflictFlow = (page: Page, name: string, errorPolicy: "stop" | "continue") => {
  const { origem, destino } = conflict();
  return seedFlow(page, name, {
    nodes: [n("start", "trigger.manual"), n("mover", "files.move", { source: join(origem, "*.pdf"), destination: destino, overwrite: false }), n("end", "flow.end", { message: "fim" })],
    edges: [e("start", "next", "mover"), e("mover", "success", "end")],
    errorPolicy,
  });
};

test("política 'continuar': a falha vira aviso e o fluxo termina 'com avisos'", async () => {
  const { app, page } = await launch(newDataDir());
  await conflictFlow(page, "Continua", "continue");
  await open(page, "Continua");
  await btn(page, "Executar").click();
  await expect(runStatus(page)).toContainText("Execução concluída com avisos", { timeout: 10_000 });
  await expect(page.getByTestId("run-warnings")).toContainText("1 nó(s) falharam");
  await expect(page.getByTestId("run-row-mover")).toContainText("Falhou — o fluxo seguiu");
  await expect(page.getByTestId("run-row-end")).toContainText("Concluído"); // seguiu adiante
  await closeApp(app);
});

test("política 'parar' (padrão): a falha aponta o nó e a causa", async () => {
  const { app, page } = await launch(newDataDir());
  await conflictFlow(page, "Para", "stop");
  await open(page, "Para");
  await btn(page, "Executar").click();
  await expect(runStatus(page)).toContainText("Execução falhou", { timeout: 10_000 });
  const err = page.getByTestId("run-error");
  await expect(err).toContainText("Nó que falhou: Mover arquivo");
  await expect(err).toContainText("já existem");
  await expect(page.getByTestId("run-row-end")).toHaveCount(0);
  await closeApp(app);
});

test("a política de erro e o tempo limite são editáveis no painel Variáveis e vão para a versão salva", async () => {
  const { app, page } = await launch(newDataDir());
  await seedWaitFlow(page, "Config", 1);
  await open(page, "Config");
  await page.getByRole("tab", { name: "Variáveis" }).click();
  await page.getByLabel("Política de erro do fluxo").selectOption("continue");
  await page.getByLabel("Tempo limite do fluxo (segundos)").fill("90");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByTestId("save-status")).toContainText("Salvo (versão 2)");
  const saved = await page.evaluate(async () => {
    const list = await window.api.automations.list();
    const id = list.ok ? list.data[0]!.id : "";
    const r = await window.api.workflows.load({ automationId: id });
    return r.ok ? r.data.document.settings : null;
  });
  expect(saved).toEqual({ timeoutSeconds: 90, errorPolicy: "continue" });
  await closeApp(app);
});

test("histórico sobrevive ao reinício: lista, detalhes com log, falha com nó e causa, filtros e limpeza", async () => {
  const dir = newDataDir();
  let a = await launch(dir);
  await seedWaitFlow(a.page, "Hist ok", 1);
  await conflictFlow(a.page, "Hist falha", "stop");
  await waitEngineReady(a.page);
  await openEditor(a.page, "Hist ok");
  await btn(a.page, "Executar").click();
  await expect(runStatus(a.page)).toContainText("Execução concluída em", { timeout: 10_000 });
  await nav(a.page, "Automações").click();
  await a.page.getByRole("button", { name: "Abrir Hist falha" }).click();
  await btn(a.page, "Executar").click();
  await expect(runStatus(a.page)).toContainText("Execução falhou", { timeout: 10_000 });
  await closeApp(a.app);

  a = await launch(dir); // reinício
  const page = a.page;
  await nav(page, "Histórico").click();
  await expect(page.getByTestId("history-list").getByRole("listitem")).toHaveCount(2);
  await expect(page.getByTestId("history-stats")).toContainText("1 concluídas");
  await expect(page.getByTestId("history-stats")).toContainText("1 falhas");

  // filtros
  await page.getByLabel("Resultado").selectOption("failed");
  await expect(page.getByTestId("history-list").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("history-list")).toContainText("Hist falha");
  await page.getByLabel("Resultado").selectOption("all");
  await page.getByLabel("Automação", { exact: true }).selectOption({ label: "Hist ok" });
  await expect(page.getByTestId("history-list").getByRole("listitem")).toHaveCount(1);
  await page.getByLabel("Automação", { exact: true }).selectOption("");

  // detalhes da falha: nó, causa e log
  await page.getByTestId("history-list").getByRole("button", { name: /Hist falha/ }).click();
  const d = page.getByTestId("history-detail");
  await expect(d.getByTestId("history-error")).toContainText("Nó que falhou: Mover arquivo");
  await expect(d.getByTestId("history-error")).toContainText("já existem");
  await expect(d.getByTestId("history-logs")).toContainText("Execução iniciada");
  await expect(d.getByTestId("history-logs")).toContainText("Execução falhou");
  await d.getByLabel("Nível do log").selectOption("error");
  await expect(d.getByTestId("history-logs").getByRole("listitem")).toHaveCount(2); // erro do nó + erro final

  // Dashboard mostra as recentes
  await nav(page, "Dashboard").click();
  await expect(page.getByTestId("recent-executions")).toContainText("Hist ok");

  // limpar histórico: pede confirmação
  await nav(page, "Histórico").click();
  await btn(page, "Limpar histórico").click();
  await page.getByRole("dialog", { name: "Limpar o histórico?" }).getByRole("button", { name: "Apagar tudo" }).click();
  await expect(page.getByTestId("history-empty")).toBeVisible();
  await closeApp(a.app);
});

test("queda do app durante a execução: ao reabrir, a execução consta como interrompida (não 'em andamento')", async () => {
  const dir = newDataDir();
  let a = await launch(dir);
  await seedWaitFlow(a.page, "Queda", 60);
  await waitEngineReady(a.page);
  await openEditor(a.page, "Queda");
  await btn(a.page, "Executar").click();
  await expect(a.page.getByTestId("run-row-w")).toContainText("Executando…");
  const pid = a.app.process().pid!;
  process.kill(pid, "SIGKILL"); // sem encerramento limpo

  a = await launch(dir);
  await nav(a.page, "Histórico").click();
  const item = a.page.getByTestId("history-list").getByRole("button", { name: /Queda/ });
  await expect(item).toContainText("Falhou");
  await expect(item).toContainText("O aplicativo foi fechado durante a execução.");
  await closeApp(a.app);
});

test("diagnóstico: desligado por padrão; ligado, falhar um nó não quebra a execução e o histórico registra a falha", async () => {
  const { app, page } = await launch(newDataDir());
  await conflictFlow(page, "Diag", "stop");
  await nav(page, "Configurações").click();
  const toggle = page.getByLabel(/Capturar a tela quando um nó falhar/);
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  expect(await page.evaluate(async () => { const r = await window.api.settings.get(); return r.ok && r.data.captureDiagnostics; })).toBe(true);

  await open(page, "Diag");
  await btn(page, "Executar").click();
  await expect(runStatus(page)).toContainText("Execução falhou", { timeout: 15_000 });
  await nav(page, "Histórico").click();
  await page.getByTestId("history-list").getByRole("button", { name: /Diag/ }).click();
  await expect(page.getByTestId("history-error")).toContainText("já existem");
  // A captura real depende da tela/compositor; aqui só validamos que, se existir, abre pela API restrita.
  const shot = page.getByRole("button", { name: "Ver captura da tela" });
  if (await shot.count()) {
    await shot.first().click();
    await expect(page.getByRole("img", { name: /Captura da tela/ })).toBeVisible();
  }
  await closeApp(app);
});
