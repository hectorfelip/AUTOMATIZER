import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1, // cada teste abre o app Electron inteiro
  timeout: 30_000,
  reporter: "list",
});
