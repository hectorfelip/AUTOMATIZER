import type { z } from "zod";
import {
  IPC,
  automationIdSchema,
  cancelExecutionSchema,
  createAutomationSchema,
  createFromTemplateSchema,
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
import type { ExecutionManager } from "../services/executions.js";
import type { TemplatesService } from "../services/templates.js";
import type { SettingsService } from "../services/settings.js";
import type { WorkflowService } from "../services/workflows.js";

/** Subconjunto de `ipcMain` usado aqui, para permitir testes sem Electron. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: { senderFrame?: { url: string } | null }, ...args: unknown[]) => unknown,
  ): void;
}

export interface IpcDeps {
  automations: AutomationService;
  settings: SettingsService;
  workflows: WorkflowService;
  engine: { readonly status: EngineStatus };
  executions: ExecutionManager;
  templates: TemplatesService;
  appInfo: AppInfo;
  /** Só frames cuja URL passa nesta checagem podem chamar o Main. */
  isTrustedUrl: (url: string) => boolean;
  onError?: (err: unknown) => void;
}

export function registerIpc(ipc: IpcMainLike, deps: IpcDeps): void {
  const route = <S extends z.ZodType, R>(channel: string, schema: S, run: (input: z.output<S>) => R) =>
    ipc.handle(channel, (event, ...args): IpcResult<R> => {
      try {
        if (!deps.isTrustedUrl(event.senderFrame?.url ?? "")) {
          throw new AppError("UNTRUSTED_SENDER", "Origem da requisição não é confiável.");
        }
        if (args.length > 1) throw new AppError("VALIDATION", "Argumentos inesperados.");
        const parsed = schema.safeParse(args[0]);
        if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0]?.message ?? "Dados inválidos.");
        return { ok: true, data: run(parsed.data) };
      } catch (err) {
        if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } };
        deps.onError?.(err); // detalhe técnico fica no log, não vai para a UI
        return { ok: false, error: { code: "INTERNAL", message: "Ocorreu um erro inesperado. Tente novamente." } };
      }
    });

  const { automations, settings, workflows } = deps;
  route(IPC.automationsList, noInputSchema, () => automations.list());
  route(IPC.automationsCreate, createAutomationSchema, (i) => automations.create(i));
  route(IPC.automationsRename, renameAutomationSchema, (i) => automations.rename(i.id, i.name));
  route(IPC.automationsArchive, automationIdSchema, (i) => automations.setArchived(i.id, true));
  route(IPC.automationsRestore, automationIdSchema, (i) => automations.setArchived(i.id, false));
  route(IPC.automationsDelete, automationIdSchema, (i) => automations.remove(i.id));
  route(IPC.workflowsLoad, loadWorkflowSchema, (i) => workflows.load(i.automationId));
  route(IPC.workflowsSave, saveWorkflowSchema, (i) => workflows.save(i.automationId, i.document));
  route(IPC.templatesList, noInputSchema, () => deps.templates.list());
  route(IPC.templatesCreate, createFromTemplateSchema, (i) => deps.templates.createAutomation(i.templateId, i.name));
  route(IPC.engineStatus, noInputSchema, () => deps.engine.status);
  route(IPC.executionsStart, startExecutionSchema, (i) => deps.executions.start(i.document));
  route(IPC.executionsCancel, cancelExecutionSchema, (i) => {
    deps.executions.cancel(i.executionId);
    return null;
  });
  route(IPC.settingsGet, noInputSchema, () => settings.get());
  route(IPC.settingsUpdate, settingsPatchSchema, (p) => settings.update(p));
  route(IPC.appInfo, noInputSchema, () => deps.appInfo);
}
