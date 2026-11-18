import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "electron-vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string> };

// Pacotes do workspace são código-fonte TS: precisam ser embutidos no bundle, não externalizados
// (o Electron não carrega .ts). A lista vem do package.json para não esquecer pacotes novos.
const workspacePackages = Object.keys(pkg.dependencies ?? {}).filter((n) => n.startsWith("@automation-studio/"));
const build = { externalizeDeps: { exclude: workspacePackages } };

export default defineConfig({
  main: { build: { ...build, rollupOptions: { external: ["node:sqlite"] } } },
  preload: { build },
  renderer: {
    plugins: [
      react(),
      tailwindcss(),
      {
        // O CSP estrito do index.html bloqueia o preamble inline do HMR; só o dev server o dispensa.
        name: "dev-relax-csp",
        apply: "serve",
        transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/, ""),
      },
    ],
  },
});
