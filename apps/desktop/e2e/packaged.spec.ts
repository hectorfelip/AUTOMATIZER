import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { newDataDir } from "./helpers";

// Só roda depois de `npm run package:dir` (Linux): valida o app EMPACOTADO, não o do repositório.
const exe = join(__dirname, "../../../release/linux-unpacked/automation-studio");
test.skip(!existsSync(exe) || process.platform !== "linux", "rode `npm run package:dir -w @automation-studio/desktop` antes");

test("app empacotado: abre, usa o motor congelado de resources/engine (sem Python do dev), executa um fluxo e guarda os dados em userData", async () => {
  const dir = newDataDir();
  const env = { ...process.env, AUTOMATION_STUDIO_USER_DATA: dir } as Record<string, string>;
  // sem override de motor nem de Python: tem que achar resources/engine sozinho
  delete env["AUTOMATION_STUDIO_ENGINE"];
  delete env["AUTOMATION_STUDIO_PYTHON"];
  const app = await electron.launch({ executablePath: exe, args: ["--no-sandbox"], env });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });

  const packaged = await app.evaluate(({ app }) => app.isPackaged);
  expect(packaged).toBe(true);
  await expect(page.getByTestId("engine-status")).toContainText("Disponível", { timeout: 20_000 });

  // cria e executa um fluxo pela API (tudo no processo empacotado)
  const res = await page.evaluate(async () => {
    const a = await window.api.automations.create({ name: "Empacotado", description: "" });
    if (!a.ok) return { err: a.error.message };
    const id = a.data.id;
    const doc = {
      schemaVersion: 1 as const, id, name: "Empacotado",
      nodes: [
        { id: "start", type: "trigger.manual", version: 1, config: {} },
        { id: "w", type: "flow.wait", version: 1, config: { seconds: 0 } },
        { id: "end", type: "flow.end", version: 1, config: {} },
      ],
      edges: [
        { id: "e1", source: "start", sourceHandle: "next", target: "w", targetHandle: "input" },
        { id: "e2", source: "w", sourceHandle: "next", target: "end", targetHandle: "input" },
      ],
      variables: {}, settings: { timeoutSeconds: 60, errorPolicy: "stop" as const }, visual: { positions: {} },
    };
    const s = await window.api.workflows.save({ automationId: id, document: doc as never });
    if (!s.ok) return { err: s.error.message };
    const r = await window.api.executions.start({ automationId: id, document: doc as never });
    if (!r.ok) return { err: r.error.message };
    for (let i = 0; i < 100; i++) {
      await new Promise((ok) => setTimeout(ok, 100));
      const l = await window.api.history.list({});
      if (l.ok && l.data.items[0] && l.data.items[0].status !== "running") return { status: l.data.items[0].status };
    }
    return { err: "não terminou" };
  });
  expect(res).toEqual({ status: "completed" });
  await app.close();
  // os dados ficaram na pasta de dados do usuário, não dentro do pacote
  expect(existsSync(join(dir, "automation-studio.db"))).toBe(true);
});
