/**
 * Contrato IPC Renderer ↔ Main (ARCHITECTURE.md §10).
 * Toda entrada é validada no Main com estes schemas; o renderer só recebe `IpcResult`.
 */

import type { WorkflowDocument } from "@automation-studio/workflow-schema";

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

export interface AppInfo {
  version: string;
  dataPath: string;
  /** Motor Python: ainda não implementado (Fase 3). */
  engineStatus: "unavailable";
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
export interface SettingsPatch {
  theme?: Theme;
}

// ---- Resultado ----
export type ErrorCode = "VALIDATION" | "NOT_FOUND" | "INVALID_DATA" | "UNTRUSTED_SENDER" | "INTERNAL";
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
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  appInfo: "app:info",
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
  settings: {
    get(): Promise<IpcResult<AppSettings>>;
    update(patch: SettingsPatch): Promise<IpcResult<AppSettings>>;
  };
  app: {
    info(): Promise<IpcResult<AppInfo>>;
  };
}
