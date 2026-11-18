import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// shared-types é código-fonte TS do workspace: precisa ser embutido no bundle, não externalizado.
const build = { externalizeDeps: { exclude: ["@automation-studio/shared-types"] } };

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
