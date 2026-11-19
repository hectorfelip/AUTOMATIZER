import type { z } from "zod";
import {
  IPC,
  automationIdSchema,
  cancelExecutionSchema,
  createAutomationSchema,
  createFromTemplateSchema,
  createScheduleSchema,
  scheduleIdSchema,
  setScheduleEnabledSchema,
  updateScheduleSchema,
  exportSchema,
  importConfirmSchema,
  historyClearSchema,
  historyDiagnosticSchema,
  historyFiltersSchema,
  historyGetSchema,
  historyStatsSchema,
  setBreakpointsSchema,
  loadWorkflowSchema,
  saveWorkflowSchema,
  noInputSchema,
  renameAutomationSchema,
  settingsPatchSchema,
  startExecutionSchema,
  type AppInfo,
  type EngineStatus,
  type IpcResult,
} from "@automation-studio/shared-types";
import type { AutomationService } from "../services/automations.js";
import { AppError } from "../services/errors.js";
import type { ScheduleService } from "../services/scheduling/schedules.js";
import type { ExchangeService } from "../services/exchange.js";
import type { ExecutionManager } from "../services/executions.js";
import type { Diagnostics } from "../services/diagnostics.js";
import type { HistoryService } from "../services/history.js";
import type { TemplatesService } from "../services/templates.js";
import type { SettingsService } from "../services/settings.js";
import type { WorkflowService } from "../services/workflows.js";

/** Subconjunto de `ipcMain` usado aqui, para permitir testes sem Electron. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (
      event: { senderFrame?: { url: string } | null },
      ...args: unknown[]
    ) => unknown,
  ): void;
}

export interface IpcDeps {
  automations: AutomationService;
  settings: SettingsService;
  workflows: WorkflowService;
  engine: { readonly status: EngineStatus };
  executions: ExecutionManager;
  history: HistoryService;
  exchange: ExchangeService;
  schedules: ScheduleService;
  diagnostics: Diagnostics;
  templates: TemplatesService;
  appInfo: AppInfo;
  /** Só frames cuja URL passa nesta checagem podem chamar o Main. */
  isTrustedUrl: (url: string) => boolean;
  onError?: (err: unknown) => void;
}

export function registerIpc(ipc: IpcMainLike, deps: IpcDeps): void {
  const fail = (err: unknown): IpcResult<never> => {
    if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } };
    deps.onError?.(err); // detalhe técnico fica no log, não vai para a UI
    return { ok: false, error: { code: "INTERNAL", message: "Ocorreu um erro inesperado. Tente novamente." } };
  };
  /** Handlers podem ser síncronos ou assíncronos (diálogos nativos); a resposta é sempre `{ ok, data | error }`. */
  const route = <S extends z.ZodType, R>(channel: string, schema: S, run: (input: z.output<S>) => R) =>
    ipc.handle(channel, (event, ...args): IpcResult<Awaited<R>> | Promise<IpcResult<Awaited<R>>> => {
      try {
        if (!deps.isTrustedUrl(event.senderFrame?.url ?? "")) {
          throw new AppError("UNTRUSTED_SENDER", "Origem da requisição não é confiável.");
        }
        if (args.length > 1) throw new AppError("VALIDATION", "Argumentos inesperados.");
        const parsed = schema.safeParse(args[0]);
        if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Dados inválidos.");
        const out = run(parsed.data);
        if (out instanceof Promise) return out.then((data): IpcResult<Awaited<R>> => ({ ok: true, data: data as Awaited<R> }), fail);
        return { ok: true, data: out as Awaited<R> };
      } catch (err) {
        return fail(err);
      }
    });

  const { automations, settings, workflows } = deps;
  route(IPC.automationsList, noInputSchema, () => automations.list());
  route(IPC.automationsCreate, createAutomationSchema, (i) =>
    automations.create(i),
  );
  route(IPC.automationsRename, renameAutomationSchema, (i) =>
    automations.rename(i.id, i.name),
  );
  route(IPC.automationsArchive, automationIdSchema, (i) =>
    automations.setArchived(i.id, true),
  );
  route(IPC.automationsRestore, automationIdSchema, (i) =>
    automations.setArchived(i.id, false),
  );
  route(IPC.automationsDelete, automationIdSchema, async (i) => {
    const files = deps.history.diagnosticPathsOf(i.id); // coletar ANTES: as linhas do histórico saem em cascata
    await deps.schedules.removeAllFor(i.id); // tarefas do Windows saem antes; as linhas de agendamento saem em cascata
    const result = automations.remove(i.id);
    deps.diagnostics.removeFiles(files);
    return result;
  });
  route(IPC.workflowsLoad, loadWorkflowSchema, (i) =>
    workflows.load(i.automationId),
  );
  route(IPC.workflowsSave, saveWorkflowSchema, (i) =>
    workflows.save(i.automationId, i.document),
  );
  route(IPC.templatesList, noInputSchema, () => deps.templates.list());
  route(IPC.templatesCreate, createFromTemplateSchema, (i) =>
    deps.templates.createAutomation(i.templateId, i.name),
  );
  route(IPC.engineStatus, noInputSchema, () => deps.engine.status);
  route(IPC.executionsStart, startExecutionSchema, (i) =>
    deps.executions.start(i.automationId, i.document, i.options),
  );
  const control = (channel: string, run: (id: string) => void) =>
    route(channel, cancelExecutionSchema, (i) => {
      run(i.executionId);
      return null;
    });
  control(IPC.executionsCancel, (id) => deps.executions.cancel(id));
  control(IPC.executionsPause, (id) => deps.executions.pause(id));
  control(IPC.executionsResume, (id) => deps.executions.resume(id));
  control(IPC.executionsStep, (id) => deps.executions.step(id));
  route(IPC.executionsBreakpoints, setBreakpointsSchema, (i) => {
    deps.executions.setBreakpoints(i.executionId, i.nodeIds);
    return null;
  });
  route(IPC.historyList, historyFiltersSchema, (f) => deps.history.list(f));
  route(IPC.historyGet, historyGetSchema, (i) =>
    deps.history.get(i.executionId),
  );
  route(IPC.historyStats, historyStatsSchema, (i) =>
    deps.history.stats(
      i.sinceDays
        ? new Date(Date.now() - i.sinceDays * 86_400_000).toISOString()
        : undefined,
    ),
  );
  route(IPC.historyClear, historyClearSchema, (i) => deps.history.clear(i));
  route(IPC.historyDiagnostic, historyDiagnosticSchema, (i) => {
    const path = deps.history.diagnosticPath(i.executionId, i.seq);
    const png = path ? deps.diagnostics.read(path) : null;
    if (!png)
      throw new AppError(
        "NOT_FOUND",
        "A captura de tela não está mais disponível.",
      );
    return `data:image/png;base64,${png.toString("base64")}`;
  });
  route(IPC.exchangeExport, exportSchema, (i) => deps.exchange.exportWorkflow(i.automationId));
  route(IPC.exchangeImportPreview, noInputSchema, () => deps.exchange.importPreview());
  route(IPC.exchangeImportConfirm, importConfirmSchema, (i) => deps.exchange.importConfirm(i.token, i.name));
  route(IPC.schedulesList, noInputSchema, () => deps.schedules.list());
  route(IPC.schedulesCreate, createScheduleSchema, (i) => deps.schedules.create(i.automationId, i.config));
  route(IPC.schedulesUpdate, updateScheduleSchema, (i) => deps.schedules.update(i.id, i.config));
  route(IPC.schedulesSetEnabled, setScheduleEnabledSchema, (i) => deps.schedules.setEnabled(i.id, i.enabled));
  route(IPC.schedulesResync, scheduleIdSchema, (i) => deps.schedules.resync(i.id));
  route(IPC.schedulesRemove, scheduleIdSchema, (i) => deps.schedules.remove(i.id));
  route(IPC.settingsGet, noInputSchema, () => settings.get());
  route(IPC.settingsUpdate, settingsPatchSchema, (p) => settings.update(p));
  route(IPC.appInfo, noInputSchema, () => deps.appInfo);
}
