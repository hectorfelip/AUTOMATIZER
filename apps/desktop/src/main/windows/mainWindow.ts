import { BrowserWindow, dialog, shell } from "electron";
import { join } from "node:path";

/** URL do dev server (dev) ou null (produção, carrega arquivo local). */
export const devServerUrl = process.env["ELECTRON_RENDERER_URL"] ?? null;

export function isTrustedUrl(url: string): boolean {
  return devServerUrl ? url.startsWith(devServerUrl) : url.startsWith("file://");
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Automation Studio",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Sem janelas novas e sem navegação para fora do app; links http(s) abrem no navegador do sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isTrustedUrl(url)) e.preventDefault();
  });
  // Fechar a janela com alterações não salvas: o renderer bloqueia (beforeunload) e aqui o usuário decide.
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Continuar editando", "Descartar e sair"],
      defaultId: 0,
      cancelId: 0,
      title: "Alterações não salvas",
      message: "Há alterações não salvas neste fluxo.",
      detail: "Se sair agora, elas serão perdidas.",
    });
    if (choice === 1) event.preventDefault(); // ignora o bloqueio: a janela fecha
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  if (devServerUrl) void win.loadURL(devServerUrl);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
  return win;
}
