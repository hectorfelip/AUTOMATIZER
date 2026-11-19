import { expect, test } from "@playwright/test";
import { closeApp, launch, newDataDir } from "./helpers";

test("abre como app desktop com dashboard e navegação lateral", async () => {
  const { app, page } = await launch(newDataDir());
  await expect(page).toHaveTitle("Automation Studio");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByTestId("active-count")).toHaveText("0");
  await expect(page.getByTestId("engine-status")).toContainText("Disponível", { timeout: 15_000 }); // o motor Python iniciou

  const nav = page.getByRole("navigation", { name: "Principal" });
  await nav.getByRole("button", { name: "Automações" }).click();
  await expect(page.getByRole("heading", { name: "Automações" })).toBeVisible();
  await nav.getByRole("button", { name: "Configurações" }).click();
  await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
  await app.close();
});

test("CRUD completo: criar, renomear, arquivar, restaurar e excluir", async () => {
  const { app, page } = await launch(newDataDir());
  await page.getByRole("button", { name: "Automações" }).click();

  await page.getByRole("button", { name: "Nova automação" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Organizar PDFs");
  await page.getByLabel("Descrição (opcional)").fill("Move PDFs para a pasta certa");
  await page.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByText("Organizar PDFs")).toBeVisible();
  await expect(page.getByText("Move PDFs para a pasta certa")).toBeVisible();

  await page.getByRole("button", { name: "Renomear Organizar PDFs" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Backup diário");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Backup diário")).toBeVisible();
  await expect(page.getByText("Organizar PDFs")).toHaveCount(0);

  await page.getByRole("button", { name: "Arquivar Backup diário" }).click();
  await expect(page.getByText("Nenhuma automação ativa")).toBeVisible();
  await page.getByRole("button", { name: /Arquivadas/ }).click();
  await expect(page.getByText("Backup diário")).toBeVisible();
  await expect(page.getByText("Arquivada", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Restaurar Backup diário" }).click();
  await expect(page.getByText("Nenhuma automação arquivada")).toBeVisible();
  await page.getByRole("button", { name: /Ativas/ }).click();
  await expect(page.getByText("Backup diário")).toBeVisible();

  // Exclusão exige confirmação; cancelar não apaga.
  await page.getByRole("button", { name: "Excluir Backup diário" }).click();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByText("Backup diário")).toBeVisible();
  await page.getByRole("button", { name: "Excluir Backup diário" }).click();
  await page.getByRole("button", { name: "Excluir definitivamente" }).click();
  await expect(page.getByText("Backup diário")).toHaveCount(0);
  await expect(page.getByText("Nenhuma automação ativa")).toBeVisible();
  await app.close();
});

test("nome vazio mostra erro específico e não cria", async () => {
  const { app, page } = await launch(newDataDir());
  await page.getByRole("button", { name: "Nova automação" }).first().click(); // via dashboard
  await page.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByRole("alert")).toHaveText("O nome não pode ficar vazio.");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByText("Nenhuma automação ativa")).toBeVisible();
  await app.close();
});

test("dados e tema persistem após fechar e reabrir", async () => {
  const dir = newDataDir();
  let { app, page } = await launch(dir);
  await page.getByRole("button", { name: "Automações" }).click();
  await page.getByRole("button", { name: "Nova automação" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Persistente");
  await page.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByText("Persistente")).toBeVisible();
  await page.getByRole("button", { name: "Configurações" }).click();
  await page.getByLabel("Escuro").check();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await app.close();

  ({ app, page } = await launch(dir));
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByTestId("active-count")).toHaveText("1");
  await page.getByRole("button", { name: "Automações" }).click();
  await expect(page.getByText("Persistente")).toBeVisible();
  await app.close();
});

test("renderer não tem acesso a Node e a API exposta é mínima", async () => {
  const { app, page } = await launch(newDataDir());
  const probe = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)["require"],
    process: typeof (globalThis as Record<string, unknown>)["process"],
    api: Object.keys(window.api).sort(),
    apiMethods: Object.fromEntries(Object.entries(window.api).map(([k, v]) => [k, Object.keys(v).sort()])),
    ipcRenderer: typeof (window as unknown as Record<string, unknown>)["ipcRenderer"],
  }));
  expect(probe.require).toBe("undefined");
  expect(probe.process).toBe("undefined");
  expect(probe.ipcRenderer).toBe("undefined");
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-eval");
  expect(probe.api).toEqual(["app", "automations", "engine", "exchange", "executions", "history", "settings", "templates", "workflows"]);
  expect(probe.apiMethods["automations"]).toEqual(["archive", "create", "delete", "list", "rename", "restore"]);
  expect(probe.apiMethods["workflows"]).toEqual(["load", "save"]);
  expect(probe.apiMethods["templates"]).toEqual(["createAutomation", "list"]);
  expect(probe.apiMethods["engine"]).toEqual(["onStatusChange", "status"]);
  expect(probe.apiMethods["executions"]).toEqual(["cancel", "onEvent", "pause", "resume", "setBreakpoints", "start", "step"]);
  expect(probe.apiMethods["exchange"]).toEqual(["exportWorkflow", "importConfirm", "importPreview"]);
  expect(probe.apiMethods["history"]).toEqual(["clear", "diagnostic", "get", "list", "stats"]);

  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences existe em runtime, mas não consta nos tipos públicos do Electron.
    const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
      getLastWebPreferences(): { contextIsolation: boolean; nodeIntegration: boolean };
    };
    const { contextIsolation, nodeIntegration } = wc.getLastWebPreferences();
    return { contextIsolation, nodeIntegration };
  });
  expect(prefs).toMatchObject({ contextIsolation: true, nodeIntegration: false });

  // O Main rejeita entrada malformada mesmo vinda do renderer.
  const bad = await page.evaluate(() => window.api.automations.create({ name: "" }));
  expect(bad).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  await app.close();
});

test("navegar para outro arquivo local ou site é bloqueado (o IPC só serve a página do app)", async () => {
  const { app, page } = await launch(newDataDir());
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const home = page.url();
  for (const target of ["file:///etc/hostname", "https://example.com/"]) {
    await page.evaluate((u) => void (window.location.href = u), target).catch(() => undefined);
    await page.waitForTimeout(400);
    expect(page.url()).toBe(home);
  }
  // (o Playwright pode ficar "esperando navegação" por uma navegação que o app cancelou: lemos o DOM direto)
  expect(await page.evaluate(() => document.body.innerText)).toContain("Dashboard");
  const ok = await page.evaluate(async () => (await window.api.app.info()).ok);
  expect(ok).toBe(true);
  await closeApp(app);
});
