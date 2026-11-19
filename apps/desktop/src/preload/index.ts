import { contextBridge, ipcRenderer } from "electron";
import { IPC, PUSH, type DesktopApi } from "@automation-studio/shared-types";

// Superfície mínima e tipada: nenhuma API genérica (ipcRenderer, fs, shell) chega ao renderer.
/** Assina um canal de eventos do Main; só o dado chega ao renderer (nunca o `event` do Electron). */
const subscribe =
  <T>(channel: string) =>
  (listener: (data: T) => void): (() => void) => {
    const handler = (_event: unknown, data: T) => listener(data);
    ipcRenderer.on(channel, handler);
    return () => void ipcRenderer.removeListener(channel, handler);
  };

const api: DesktopApi = {
  automations: {
    list: () => ipcRenderer.invoke(IPC.automationsList),
    create: (input) => ipcRenderer.invoke(IPC.automationsCreate, input),
    rename: (input) => ipcRenderer.invoke(IPC.automationsRename, input),
    archive: (input) => ipcRenderer.invoke(IPC.automationsArchive, input),
    restore: (input) => ipcRenderer.invoke(IPC.automationsRestore, input),
    delete: (input) => ipcRenderer.invoke(IPC.automationsDelete, input),
  },
  workflows: {
    load: (input) => ipcRenderer.invoke(IPC.workflowsLoad, input),
    save: (input) => ipcRenderer.invoke(IPC.workflowsSave, input),
  },
  templates: {
    list: () => ipcRenderer.invoke(IPC.templatesList),
    createAutomation: (input) => ipcRenderer.invoke(IPC.templatesCreate, input),
  },
  engine: {
    status: () => ipcRenderer.invoke(IPC.engineStatus),
    onStatusChange: subscribe(PUSH.engineStatus),
  },
  executions: {
    start: (input) => ipcRenderer.invoke(IPC.executionsStart, input),
    cancel: (input) => ipcRenderer.invoke(IPC.executionsCancel, input),
    pause: (input) => ipcRenderer.invoke(IPC.executionsPause, input),
    resume: (input) => ipcRenderer.invoke(IPC.executionsResume, input),
    step: (input) => ipcRenderer.invoke(IPC.executionsStep, input),
    setBreakpoints: (input) => ipcRenderer.invoke(IPC.executionsBreakpoints, input),
    onEvent: subscribe(PUSH.executionEvent),
  },
  history: {
    list: (filters) => ipcRenderer.invoke(IPC.historyList, filters),
    get: (input) => ipcRenderer.invoke(IPC.historyGet, input),
    stats: (input) => ipcRenderer.invoke(IPC.historyStats, input),
    clear: (input) => ipcRenderer.invoke(IPC.historyClear, input),
    diagnostic: (input) => ipcRenderer.invoke(IPC.historyDiagnostic, input),
  },
  exchange: {
    exportWorkflow: (input) => ipcRenderer.invoke(IPC.exchangeExport, input),
    importPreview: () => ipcRenderer.invoke(IPC.exchangeImportPreview),
    importConfirm: (input) => ipcRenderer.invoke(IPC.exchangeImportConfirm, input),
  },
  schedules: {
    list: () => ipcRenderer.invoke(IPC.schedulesList),
    create: (input) => ipcRenderer.invoke(IPC.schedulesCreate, input),
    update: (input) => ipcRenderer.invoke(IPC.schedulesUpdate, input),
    setEnabled: (input) => ipcRenderer.invoke(IPC.schedulesSetEnabled, input),
    resync: (input) => ipcRenderer.invoke(IPC.schedulesResync, input),
    remove: (input) => ipcRenderer.invoke(IPC.schedulesRemove, input),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  },
  app: { info: () => ipcRenderer.invoke(IPC.appInfo) },
};

contextBridge.exposeInMainWorld("api", api);
