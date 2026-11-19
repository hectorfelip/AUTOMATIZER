import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen } from "electron";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { PUSH } from "@automation-studio/shared-types";
import { openDatabase } from "./database/db.js";
import { DatabaseTooNewError } from "./database/migrate.js";
import { registerIpc } from "./ipc/register.js";
import { EngineClient } from "./services/engine/client.js";
import { resolveEngineLaunch } from "./services/engine/launch.js";
import { createDiagnostics } from "./services/diagnostics.js";
import { createHistoryService } from "./services/history.js";
import { createScheduleService } from "./services/scheduling/schedules.js";
import { createTaskScheduler } from "./services/scheduling/taskScheduler.js";
import { createScheduledRunner, parseLaunchArgs } from "./services/scheduledRun.js";
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
    let db: ReturnType<typeof openDatabase>;
    try {
      db = openDatabase(join(app.getPath("userData"), "automation-studio.db"));
    } catch (err) {
      // banco de uma versão mais nova (ou ilegível): NÃO mexe nele; explica e fecha
      const msg =
        err instanceof DatabaseTooNewError
          ? "Seus dados foram criados por uma versão mais nova do Automation Studio. Atualize o aplicativo para abri-los; nada foi alterado."
          : `Não foi possível abrir o banco de dados. Seus dados não foram alterados. (${err instanceof Error ? err.message : "erro desconhecido"})`;
      dialog.showErrorBox("Automation Studio", msg);
      app.exit(1);
      return;
    }

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
    // Agendamentos: o Agendador do Windows chama o app com `--run-automation=<id> --schedule=<id>`.
    const launch = parseLaunchArgs(process.argv);
    const scheduledRuns = new Map<string, string>(); // execução → agendamento que a disparou
    const schedulerHolder: { current: ReturnType<typeof createScheduleService> | null } = { current: null };
    const executions = createExecutionManager({
      onFinished: (executionId, status) => {
        const scheduleId = scheduledRuns.get(executionId);
        if (!scheduleId) return;
        scheduledRuns.delete(executionId);
        schedulerHolder.current?.recordRun(scheduleId, status);
        if (launch) app.quit(); // este processo foi aberto só para rodar o agendamento
      },
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
    const tasks = createTaskScheduler({
      // só o app instalado no Windows se registra no Agendador (em desenvolvimento o executável seria o do Electron, sem o app)
      platform: app.isPackaged ? process.platform : "linux",
      run: (file, args) =>
        new Promise((done) => {
          execFile(file, args, { windowsHide: true, timeout: 30_000 }, (err, stdout, stderr) =>
            done({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
          );
        }),
      writeTemp: (name, content) => {
        const dir = mkdtempSync(join(tmpdir(), "as-task-"));
        const path = join(dir, `${name}.xml`);
        writeFileSync(path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, "utf16le")])); // o schtasks espera UTF-16 LE com BOM
        return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
      },
    });
    const schedules = createScheduleService(db, { tasks, command: { file: process.execPath } });
    schedulerHolder.current = schedules;
    void schedules.refresh();
    const waitEngineReady = () =>
      new Promise<boolean>((done) => {
        const check = () => (engine.status.state === "ready" ? true : engine.status.state === "unavailable" ? false : null);
        const now = check();
        if (now !== null) return done(now);
        const timer = setTimeout(() => (engine.off("status", on), done(false)), 30_000);
        const on = () => {
          const r = check();
          if (r === null) return;
          clearTimeout(timer);
          engine.off("status", on);
          done(r);
        };
        engine.on("status", on);
      });
    const runner = createScheduledRunner({
      waitEngineReady,
      isRunning: () => executions.isRunning(),
      loadSaved: (id) => workflows.load(id),
      automationStatus: (id) => automations.list().find((a) => a.id === id)?.status ?? null,
      scheduleEnabled: (id) => schedules.list().find((s) => s.id === id)?.enabled ?? null,
      start: (automationId, doc, scheduleId) => {
        const r = executions.start(automationId, doc, {}, { scheduleId });
        scheduledRuns.set(r.executionId, scheduleId);
        return r;
      },
      recordSkipped: (id, why) => schedules.recordRun(id, why),
      log: (m) => console.warn(`[agendamento] ${m}`),
    });
    registerIpc(ipcMain, {
      schedules,
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
    // aberto pelo Agendador: roda e, se não conseguiu nem começar, fecha; se começou, fecha ao terminar (onFinished)
    if (launch) void runner.run(launch).then((outcome) => outcome === "skipped" && app.quit());
    // app já aberto e o Agendador chamou de novo: a instância em execução cuida (sem roubar o foco)
    app.on("second-instance", (_e, argv) => {
      const l = parseLaunchArgs(argv);
      if (l) void runner.run(l);
    });

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
