import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const newDataDir = () => mkdtempSync(join(tmpdir(), "automation-studio-e2e-"));

/** Abre o app compilado (`npm run build` antes) com dados isolados em `dataDir`. */
export async function launch(dataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js"), ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, AUTOMATION_STUDIO_USER_DATA: dataDir },
  });
  const page = await app.firstWindow();
  return { app, page };
}
