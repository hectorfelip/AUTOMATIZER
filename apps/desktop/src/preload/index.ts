import { contextBridge, ipcRenderer } from "electron";
import { IPC, type DesktopApi } from "@automation-studio/shared-types";

// Superfície mínima e tipada: nenhuma API genérica (ipcRenderer, fs, shell) chega ao renderer.
const api: DesktopApi = {
  automations: {
    list: () => ipcRenderer.invoke(IPC.automationsList),
    create: (input) => ipcRenderer.invoke(IPC.automationsCreate, input),
    rename: (input) => ipcRenderer.invoke(IPC.automationsRename, input),
    archive: (input) => ipcRenderer.invoke(IPC.automationsArchive, input),
    restore: (input) => ipcRenderer.invoke(IPC.automationsRestore, input),
    delete: (input) => ipcRenderer.invoke(IPC.automationsDelete, input),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  },
  app: { info: () => ipcRenderer.invoke(IPC.appInfo) },
};

contextBridge.exposeInMainWorld("api", api);
