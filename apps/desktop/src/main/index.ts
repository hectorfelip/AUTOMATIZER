import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen } from "electron";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { PUSH } from "@automation-studio/shared-types";
import { openDatabase } from "./database/db.js";
import { registerIpc } from "./ipc/register.js";
import { EngineClient } from "./services/engine/client.js";
import { resolveEngineLaunch } from "./services/engine/launch.js";
import { createDiagnostics } from "./services/diagnostics.js";
import { createHistoryService } from "./services/history.js";
import { createExchangeService } from "./services/exchange.js";
import { createExecutionManager } from "./services/executions.js";
import { createAutomationService } from "./services/automations.js";
import { createTemplatesService } from "./services/templates.js";
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
    const db = openDatabase(
      join(app.getPath("userData"), "automation-studio.db"),
    );

    const broadcast = (channel: string, data: unknown) => {
      for (const w of BrowserWindow.getAllWindows())
        if (!w.isDestroyed()) w.webContents.send(channel, data);
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
      log: (level, message) =>
        console[level === "debug" ? "log" : level](`[engine] ${message}`),
    });
    engine.on("status", (status) => broadcast(PUSH.engineStatus, status));
    const automations = createAutomationService(db);
    const workflows = createWorkflowService(db);
    const settings = createSettingsService(db);
    const diagnostics = createDiagnostics({
      baseDir: join(app.getPath("userData"), "diagnostics"),
      capture: async () => {
        // captura a tela principal; qualquer falha vira "sem captura" (a execução não é afetada)
        const { width, height } = screen.getPrimaryDisplay().size;
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width, height },
        });
        return sources[0]?.thumbnail.toPNG() ?? null;
      },
    });
    const history = createHistoryService(db, {
      removeFiles: (paths) => diagnostics.removeFiles(paths),
    });
    history.recoverInterrupted(); // execuções que ficaram "em andamento" porque o app fechou de forma abrupta
    const executions = createExecutionManager({
      engine,
      emit: (event) => broadcast(PUSH.executionEvent, event),
      history,
      workflows,
      captureEnabled: () => settings.get().captureDiagnostics,
      captureDiagnostic: (executionId, nodeId) =>
        diagnostics.capture(executionId, nodeId),
    });
    const exchange = createExchangeService({
      automations,
      workflows,
      appVersion: app.getVersion(),
      io: {
        // o diálogo é nativo e só o Main o abre; o renderer nunca informa caminhos
        pickSavePath: async (defaultName) => {
          const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          const opts = { title: "Exportar fluxo", defaultPath: defaultName, filters: [{ name: "Fluxo do Automation Studio", extensions: ["json"] }] };
          const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
          return r.canceled || !r.filePath ? null : r.filePath;
        },
        pickOpenPath: async () => {
          const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
          const opts = { title: "Importar fluxo", properties: ["openFile" as const], filters: [{ name: "Fluxo do Automation Studio", extensions: ["json"] }] };
          const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
          return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
        },
        statSize: (p) => statSync(p).size,
        readText: (p) => readFileSync(p, "utf8"),
        writeText: (p, t) => writeFileSync(p, t, "utf8"),
        baseName: (p) => basename(p),
      },
    });
    registerIpc(ipcMain, {
      exchange,
      templates: createTemplatesService({ automations, workflows }),
      engine,
      executions,
      history,
      diagnostics,
      automations,
      settings,
      workflows,
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
      void executions
        .shutdown()
        .then(() => engine.stop())
        .finally(() => {
          db.close();
          app.quit();
        });
    });
  });
  app.on("window-all-closed", () => app.quit());
}
