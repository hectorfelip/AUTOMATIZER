import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { alive, closeApp, enginePid, launch, newDataDir, openEditor, seedWaitFlow, waitEngineReady } from "./helpers";

// Os testes que mexem no processo do motor usam pgrep/kill: só Linux/macOS.
const posix = process.platform !== "win32";

const runStatus = (page: import("@playwright/test").Page) => page.getByTestId("run-status");

test("o motor Python inicia e o Dashboard mostra versão e estado", async () => {
  const { app, page } = await launch(newDataDir());
  const card = page.getByTestId("engine-status");
  await expect(card).toContainText("Disponível", { timeout: 15_000 });
  await expect(card).toContainText(/Motor 0\.1\.0 · Python 3\.\d+/);
  await closeApp(app);
});

test("executa um fluxo e os eventos aparecem na interface em tempo real", async () => {
  const { app, page } = await launch(newDataDir());
  await seedWaitFlow(page, "Fluxo run", 2);
  await waitEngineReady(page);
  await openEditor(page, "Fluxo run");

  await page.getByRole("button", { name: "Executar" }).click();
  await expect(runStatus(page)).toContainText("Executando");
  const wait = page.getByTestId("run-row-w");
  await expect(wait).toContainText("Executando…");
  await expect(wait.getByRole("progressbar")).toBeVisible(); // progresso do nó
  await expect(page.getByRole("button", { name: "Cancelar" })).toBeVisible();

  await expect(runStatus(page)).toContainText("Execução concluída em", { timeout: 10_000 });
  await expect(wait).toContainText("Concluído");
  await expect(wait).toContainText("Aguardou 2s.");
  await expect(page.getByTestId("run-row-start")).toContainText("Concluído");
  await expect(page.getByTestId("run-row-end")).toContainText("Pronto");
  await expect(page.getByRole("button", { name: "Executar" })).toBeEnabled(); // pode rodar de novo
  await closeApp(app);
});

test("cancelar interrompe a espera rapidamente e o motor continua utilizável", async () => {
  const { app, page } = await launch(newDataDir());
  await seedWaitFlow(page, "Fluxo cancel", 60);
  await waitEngineReady(page);
  await openEditor(page, "Fluxo cancel");

  await page.getByRole("button", { name: "Executar" }).click();
  await expect(page.getByTestId("run-row-w")).toContainText("Executando…");
  const t0 = Date.now();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(runStatus(page)).toContainText("Execução cancelada", { timeout: 5000 });
  expect(Date.now() - t0).toBeLessThan(4000);

  // não ficou em estado inconsistente: o Dashboard segue "Disponível" e dá para executar de novo
  await page.getByRole("button", { name: "Limpar" }).click();
  await page.getByRole("button", { name: "Executar" }).click();
  await expect(page.getByTestId("run-row-w")).toContainText("Executando…");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(runStatus(page)).toContainText("Execução cancelada", { timeout: 5000 });
  await closeApp(app);
});

test("motor indisponível: o app abre, explica o motivo e bloqueia a execução", async () => {
  const { app, page } = await launch(newDataDir(), { AUTOMATION_STUDIO_PYTHON: "/caminho/inexistente/python" });
  const card = page.getByTestId("engine-status");
  await expect(card).toContainText("Indisponível", { timeout: 15_000 });
  await expect(card).toContainText("Python 3.11");

  await seedWaitFlow(page, "Fluxo sem motor", 1); // o resto do app funciona normalmente
  await openEditor(page, "Fluxo sem motor");
  const run = page.getByRole("button", { name: "Executar" });
  await expect(run).toBeDisabled();
  await expect(run).toHaveAttribute("title", /Indisponível|indisponível/);

  // mesmo forçando pela API, a resposta é uma mensagem clara (nunca exceção)
  const res = await page.evaluate(async () => {
    const list = await window.api.automations.list();
    const id = list.ok ? list.data[0]!.id : "";
    const doc = await window.api.workflows.load({ automationId: id });
    return window.api.executions.start({ document: doc.ok ? doc.data.document : (undefined as never) });
  });
  expect(res).toMatchObject({ ok: false, error: { code: "ENGINE_UNAVAILABLE" } });
  await closeApp(app);
});

test("queda do motor durante a execução: erro claro, o app não cai e o motor volta", async () => {
  test.skip(!posix, "usa pgrep/kill");
  const { app, page } = await launch(newDataDir());
  await seedWaitFlow(page, "Fluxo crash", 60);
  await waitEngineReady(page);
  await openEditor(page, "Fluxo crash");
  await page.getByRole("button", { name: "Executar" }).click();
  await expect(page.getByTestId("run-row-w")).toContainText("Executando…");

  process.kill(await enginePid(app), "SIGKILL"); // derruba o motor de verdade

  await expect(runStatus(page)).toContainText("Execução falhou", { timeout: 10_000 });
  await expect(page.getByRole("alert").filter({ hasText: "O motor de automação encerrou inesperadamente." })).toBeVisible();
  await expect(page.getByTestId("run-row-w")).toContainText("Falhou");
  await expect(page.getByRole("heading", { name: "Fluxo crash" })).toBeVisible(); // o app segue de pé

  // o motor reinicia sozinho e uma nova execução funciona
  await expect(page.getByRole("button", { name: "Executar" })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("button", { name: "Limpar" }).click();
  await page.getByRole("button", { name: "Executar" }).click();
  await expect(page.getByTestId("run-row-w")).toContainText("Executando…");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(runStatus(page)).toContainText("Execução cancelada", { timeout: 5000 });
  await closeApp(app);
});

test("ao fechar o app o motor encerra (nenhum processo órfão)", async () => {
  test.skip(!posix, "usa pgrep/kill");
  const { app, page } = await launch(newDataDir());
  await expect(page.getByTestId("engine-status")).toContainText("Disponível", { timeout: 15_000 });
  const pid = await enginePid(app);
  expect(alive(pid)).toBe(true);
  await closeApp(app);
  await expect.poll(() => alive(pid), { timeout: 5000 }).toBe(false);
});

test("o Electron inicia o motor EMPACOTADO (executável congelado), sem Python no PATH", async () => {
  const exe = resolve(__dirname, "../../../engine/python/dist/automation-engine", posix ? "automation-engine" : "automation-engine.exe");
  test.skip(!existsSync(exe), "gere o executável antes: python scripts/build-engine.py");
  const noPython = (process.env["PATH"] ?? "").split(delimiter).filter((p) => p && !/python/i.test(p)).join(delimiter);
  const { app, page } = await launch(newDataDir(), { AUTOMATION_STUDIO_ENGINE: exe, PATH: noPython });
  await expect(page.getByTestId("engine-status")).toContainText("Disponível", { timeout: 15_000 });
  await seedWaitFlow(page, "Fluxo empacotado", 1);
  await openEditor(page, "Fluxo empacotado");
  await page.getByRole("button", { name: "Executar" }).click();
  await expect(runStatus(page)).toContainText("Execução concluída", { timeout: 10_000 });
  await closeApp(app);
});
