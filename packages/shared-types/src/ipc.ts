/**
 * Contrato IPC Renderer ↔ Main (ARCHITECTURE.md §10).
 * Toda entrada é validada no Main com estes schemas; o renderer só recebe `IpcResult`.
 */

import type { WorkflowDocument } from "@automation-studio/workflow-schema";
import type { EngineStatus } from "./engine.js";
import type { ExecutionEvent, StartExecutionOptions, StartExecutionResult } from "./execution.js";
import type { CreateScheduleInput, Schedule, ScheduleIdInput, SetScheduleEnabledInput, UpdateScheduleInput } from "./schedule.js";
import type { ClearHistoryInput, ExecutionDetail, HistoryFilters, HistoryPage, HistoryStats } from "./history.js";

// ---- Entidades ----
export type AutomationStatus = "active" | "archived";

export interface Automation {
  id: string;
  name: string;
  description: string;
  status: AutomationStatus;
  createdAt: string;
  updatedAt: string;
}

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export interface AppSettings {
  theme: Theme;
  /** Captura a tela quando um nó falha (desligado por padrão; fica só neste computador). */
  captureDiagnostics: boolean;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  /** Usa ações que só existem no Windows. */
  windowsOnly: boolean;
}

export interface WorkflowLoadResult {
  document: WorkflowDocument;
  /** Versão salva carregada; 0 = automação nova, ainda sem nenhum salvamento. */
  version: number;
}

export interface WorkflowSaveResult {
  version: number;
  /** true quando o conteúdo era idêntico à versão atual e nenhuma versão nova foi criada. */
  unchanged: boolean;
  savedAt: string;
}

/** Resumo mostrado ANTES de importar; o conteúdo só entra no banco após `importConfirm` (e nunca é executado). */
export interface ImportPreview {
  /** Referência ao conteúdo já validado, guardado no Main (o renderer nunca manda o fluxo de volta). */
  token: string;
  fileName: string;
  name: string;
  description: string;
  exportedAt: string;
  appVersion: string;
  nodeCount: number;
  edgeCount: number;
  variableCount: number;
  /** Tipos de nó usados, com contagem, já com o nome legível. */
  nodes: { label: string; count: number }[];
  errorPolicy: "stop" | "continue";
  timeoutSeconds: number;
  /** Problemas do fluxo (o editor mostra o resto). Importar é permitido; executar só sem erros. */
  issues: { errors: number; warnings: number; first: string[] };
  /** Usa ações que só funcionam no Windows. */
  windowsOnly: boolean;
}
export interface ExportInput {
  automationId: string;
}
/** `null` = o usuário cancelou o diálogo. */
export interface ExportResult {
  path: string;
}
export interface ImportConfirmInput {
  token: string;
  name?: string;
}
export interface AppInfo {
  version: string;
  dataPath: string;
}

// ---- Tipos de entrada (espelham os schemas em schemas.ts) ----
export interface CreateAutomationInput {
  name: string;
  description?: string;
}
export interface RenameAutomationInput {
  id: string;
  name: string;
}
export interface AutomationIdInput {
  id: string;
}
export interface LoadWorkflowInput {
  automationId: string;
}
export interface SaveWorkflowInput {
  automationId: string;
  document: WorkflowDocument;
}
export interface CreateFromTemplateInput {
  templateId: string;
  name?: string;
}
export interface StartExecutionInput {
  /** A automação a que o histórico desta execução pertence. */
  automationId: string;
  document: WorkflowDocument;
  options?: StartExecutionOptions;
}
export interface CancelExecutionInput {
  executionId: string;
}
/** Pausar, continuar, próximo passo. */
export type ControlExecutionInput = CancelExecutionInput;
export interface SetBreakpointsInput {
  executionId: string;
  nodeIds: string[];
}
export interface SettingsPatch {
  theme?: Theme;
  captureDiagnostics?: boolean;
}
export interface HistoryGetInput {
  executionId: string;
}
export interface HistoryStatsInput {
  /** Só execuções dos últimos N dias. */
  sinceDays?: number;
}
export interface HistoryDiagnosticInput {
  executionId: string;
  seq: number;
}

// ---- Resultado ----
export type ErrorCode = "VALIDATION" | "NOT_FOUND" | "INVALID_DATA" | "ENGINE_UNAVAILABLE" | "EXECUTION_BUSY" | "IO_ERROR" | "UNTRUSTED_SENDER" | "INTERNAL";
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

// ---- Canais ----
export const IPC = {
  automationsList: "automations:list",
  automationsCreate: "automations:create",
  automationsRename: "automations:rename",
  automationsArchive: "automations:archive",
  automationsRestore: "automations:restore",
  automationsDelete: "automations:delete",
  workflowsLoad: "workflows:load",
  workflowsSave: "workflows:save",
  engineStatus: "engine:status",
  executionsStart: "executions:start",
  executionsCancel: "executions:cancel",
  executionsPause: "executions:pause",
  executionsResume: "executions:resume",
  executionsStep: "executions:step",
  executionsBreakpoints: "executions:breakpoints",
  templatesList: "templates:list",
  templatesCreate: "templates:create",
  historyList: "history:list",
  historyGet: "history:get",
  historyStats: "history:stats",
  historyClear: "history:clear",
  historyDiagnostic: "history:diagnostic",
  exchangeExport: "exchange:export",
  exchangeImportPreview: "exchange:import-preview",
  exchangeImportConfirm: "exchange:import-confirm",
  schedulesList: "schedules:list",
  schedulesCreate: "schedules:create",
  schedulesUpdate: "schedules:update",
  schedulesSetEnabled: "schedules:set-enabled",
  schedulesResync: "schedules:resync",
  schedulesRemove: "schedules:remove",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  appInfo: "app:info",
} as const;

/** Canais de eventos empurrados pelo Main (não são `invoke`). */
export const PUSH = {
  engineStatus: "engine:status-changed",
  executionEvent: "executions:event",
} as const;

// ---- API exposta ao renderer via preload (window.api) ----
export interface DesktopApi {
  automations: {
    list(): Promise<IpcResult<Automation[]>>;
    create(input: CreateAutomationInput): Promise<IpcResult<Automation>>;
    rename(input: RenameAutomationInput): Promise<IpcResult<Automation>>;
    archive(input: AutomationIdInput): Promise<IpcResult<Automation>>;
    restore(input: AutomationIdInput): Promise<IpcResult<Automation>>;
    delete(input: AutomationIdInput): Promise<IpcResult<null>>;
  };
  workflows: {
    load(input: LoadWorkflowInput): Promise<IpcResult<WorkflowLoadResult>>;
    save(input: SaveWorkflowInput): Promise<IpcResult<WorkflowSaveResult>>;
  };
  templates: {
    list(): Promise<IpcResult<TemplateInfo[]>>;
    /** Cria uma automação nova a partir de um exemplo pronto. */
    createAutomation(input: CreateFromTemplateInput): Promise<IpcResult<Automation>>;
  };
  engine: {
    status(): Promise<IpcResult<EngineStatus>>;
    /** Retorna a função que cancela a assinatura. */
    onStatusChange(listener: (status: EngineStatus) => void): () => void;
  };
  executions: {
    start(input: StartExecutionInput): Promise<IpcResult<StartExecutionResult>>;
    cancel(input: CancelExecutionInput): Promise<IpcResult<null>>;
    /** Cooperativo: vale no próximo limite entre nós (a ação em andamento termina antes). */
    pause(input: ControlExecutionInput): Promise<IpcResult<null>>;
    resume(input: ControlExecutionInput): Promise<IpcResult<null>>;
    /** Executa um nó e pausa de novo. */
    step(input: ControlExecutionInput): Promise<IpcResult<null>>;
    setBreakpoints(input: SetBreakpointsInput): Promise<IpcResult<null>>;
    onEvent(listener: (event: ExecutionEvent) => void): () => void;
  };
  history: {
    list(filters: HistoryFilters): Promise<IpcResult<HistoryPage>>;
    get(input: HistoryGetInput): Promise<IpcResult<ExecutionDetail>>;
    stats(input: HistoryStatsInput): Promise<IpcResult<HistoryStats>>;
    clear(input: ClearHistoryInput): Promise<IpcResult<{ deleted: number }>>;
    /** Captura de tela de uma entrada de log, como data URL (PNG). */
    diagnostic(input: HistoryDiagnosticInput): Promise<IpcResult<string>>;
  };
  exchange: {
    /** Abre "Salvar como"; grava a versão salva do fluxo. */
    exportWorkflow(input: ExportInput): Promise<IpcResult<ExportResult | null>>;
    /** Abre "Abrir arquivo", valida e devolve o resumo. Não cria nada. */
    importPreview(): Promise<IpcResult<ImportPreview | null>>;
    /** Cria a automação (versão 1) a partir da prévia. Nunca executa. */
    importConfirm(input: ImportConfirmInput): Promise<IpcResult<Automation>>;
  };
  schedules: {
    list(): Promise<IpcResult<Schedule[]>>;
    create(input: CreateScheduleInput): Promise<IpcResult<Schedule>>;
    update(input: UpdateScheduleInput): Promise<IpcResult<Schedule>>;
    setEnabled(input: SetScheduleEnabledInput): Promise<IpcResult<Schedule>>;
    /** Tenta registrar de novo no Agendador do Windows. */
    resync(input: ScheduleIdInput): Promise<IpcResult<Schedule>>;
    remove(input: ScheduleIdInput): Promise<IpcResult<null>>;
  };
  settings: {
    get(): Promise<IpcResult<AppSettings>>;
    update(patch: SettingsPatch): Promise<IpcResult<AppSettings>>;
  };
  app: {
    info(): Promise<IpcResult<AppInfo>>;
  };
}
