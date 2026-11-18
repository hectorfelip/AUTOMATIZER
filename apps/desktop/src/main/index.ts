import { app, ipcMain } from "electron";
import { join } from "node:path";
import { openDatabase } from "./database/db.js";
import { registerIpc } from "./ipc/register.js";
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
    registerIpc(ipcMain, {
      automations: createAutomationService(db),
      settings: createSettingsService(db),
      workflows: createWorkflowService(db),
      appInfo: { version: app.getVersion(), dataPath: app.getPath("userData"), engineStatus: "unavailable" },
      isTrustedUrl,
      onError: (err) => console.error("[ipc]", err),
    });
    createMainWindow();
    app.on("before-quit", () => db.close());
  });
  app.on("window-all-closed", () => app.quit());
}
