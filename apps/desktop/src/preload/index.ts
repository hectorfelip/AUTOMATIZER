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
    onEvent: subscribe(PUSH.executionEvent),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  },
  app: { info: () => ipcRenderer.invoke(IPC.appInfo) },
};

contextBridge.exposeInMainWorld("api", api);
