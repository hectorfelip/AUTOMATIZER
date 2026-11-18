import { app, BrowserWindow, ipcMain } from "electron";
import { join, resolve } from "node:path";
import { PUSH } from "@automation-studio/shared-types";
import { openDatabase } from "./database/db.js";
import { registerIpc } from "./ipc/register.js";
import { EngineClient } from "./services/engine/client.js";
import { resolveEngineLaunch } from "./services/engine/launch.js";
import { createExecutionManager } from "./services/executions.js";
import { createAutomationService } from "./services/automations.js";
import { createSettingsService } from "./services/settings.js";
import { createWorkflowService } from "./services/workflows.js";
import { createMainWindow, isTrustedUrl } from "./windows/mainWindow.js";

// Permite aos testes e2e isolar os dados; em uso normal vale o diretório padrão do usuário.
const userDataOverride = process.env["AUTOMATION_STUDIO_USER_DATA"];
if (userDataOverride) app.setPath("userData", userDataOverride);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(() => {
    const db = openDatabase(join(app.getPath("userData"), "automation-studio.db"));

    const broadcast = (channel: string, data: unknown) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, data);
    };
    const engine = new EngineClient({
      launch: () =>
        resolveEngineLaunch({
          platform: process.platform,
          env: process.env,
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          // o bundle fica em apps/desktop/out/main (no dev e no e2e); app.getAppPath() varia conforme o modo de início
          repoRoot: resolve(__dirname, "..", "..", "..", ".."),
        }),
      log: (level, message) => console[level === "debug" ? "log" : level](`[engine] ${message}`),
    });
    engine.on("status", (status) => broadcast(PUSH.engineStatus, status));
    const executions = createExecutionManager({ engine, emit: (event) => broadcast(PUSH.executionEvent, event) });

    registerIpc(ipcMain, {
      engine,
      executions,
      automations: createAutomationService(db),
      settings: createSettingsService(db),
      workflows: createWorkflowService(db),
      appInfo: { version: app.getVersion(), dataPath: app.getPath("userData") },
      isTrustedUrl,
      onError: (err) => console.error("[ipc]", err),
    });
    createMainWindow();
    engine.start(); // não bloqueia: a interface abre e o indicador acompanha o status

    // Ao sair: cancela a execução, pede ao motor que encerre (até 2 s) e só então fecha o banco.
    let closing = false;
    app.on("before-quit", (event) => {
      if (closing) return;
      closing = true;
      event.preventDefault();
      executions.shutdown();
      void engine.stop().finally(() => {
        db.close();
        app.quit();
      });
    });
  });
  app.on("window-all-closed", () => app.quit());
}
