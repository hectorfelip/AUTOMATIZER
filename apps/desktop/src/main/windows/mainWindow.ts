import { BrowserWindow, dialog, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** URL do dev server (dev) ou null (produção, carrega arquivo local). */
export const devServerUrl = process.env["ELECTRON_RENDERER_URL"] ?? null;

/** Só a página do app (ignorando #hash e ?query) é confiável; outro arquivo local NÃO é. */
export function matchesAppFile(url: string, indexFileUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(indexFileUrl);
    return a.protocol === "file:" && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

const indexFileUrl = () => pathToFileURL(join(__dirname, "../renderer/index.html")).href;

export function isTrustedUrl(url: string): boolean {
  if (devServerUrl) return url === devServerUrl || url.startsWith(devServerUrl.replace(/\/?$/, "/"));
  return matchesAppFile(url, indexFileUrl());
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
  win.webContents.on("will-redirect", (e, url) => {
    if (!isTrustedUrl(url)) e.preventDefault();
  });
  win.webContents.on("will-attach-webview", (e) => e.preventDefault()); // sem <webview>
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
  win.webContents.session.setPermissionCheckHandler(() => false);

  if (devServerUrl) void win.loadURL(devServerUrl);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
  return win;
}
