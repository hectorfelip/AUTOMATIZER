import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const newDataDir = () => mkdtempSync(join(tmpdir(), "automation-studio-e2e-"));

/** Abre o app compilado (`npm run build` antes) com dados isolados em `dataDir`. */
export async function launch(dataDir: string, extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, "../out/main/index.js"), ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, AUTOMATION_STUDIO_USER_DATA: dataDir, ...extraEnv },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });
  return { app, page };
}

/**
 * Fecha o app. Se o editor estiver com alterações não salvas, o Main abre um diálogo nativo
 * (will-prevent-unload) que bloquearia o teste: respondemos "Descartar e sair".
 */
export async function closeApp(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = (() => 1) as never;
  });
  await app.close();
}

/** Cria uma automação pela UI. */
export async function createAutomation(page: Page, name: string): Promise<void> {
  await page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name: "Automações" }).click();
  await page.getByRole("button", { name: "Nova automação" }).click();
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

export async function openEditor(page: Page, name: string): Promise<void> {
  await page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name: "Automações" }).click();
  await page.getByRole("button", { name: `Abrir ${name}` }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

export const palette = (page: Page) => page.getByRole("complementary", { name: "Biblioteca de nós" });
export const node = (page: Page, text: string): Locator => page.locator(".react-flow__node", { hasText: text });

/** Arrasta um item da paleta até uma posição do canvas, em frações (0–1) do tamanho visível dele. */
export async function dragToCanvas(page: Page, label: string, at: { x: number; y: number }): Promise<void> {
  const before = await page.locator(".react-flow__node").count();
  const pane = page.locator(".react-flow__pane");
  const box = (await pane.boundingBox())!;
  await palette(page)
    .getByRole("button", { name: label, exact: true })
    .dragTo(pane, { targetPosition: { x: Math.round(box.width * at.x), y: Math.round(box.height * at.y) } });
  await expect(page.locator(".react-flow__node")).toHaveCount(before + 1);
}

const center = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** Liga uma saída de um nó à entrada de outro arrastando de handle a handle. */
export async function connectNodes(page: Page, from: Locator, fromPort: string, to: Locator, toPort = "input"): Promise<void> {
  const a = await center(from.locator(`.react-flow__handle.source[data-handleid="${fromPort}"]`));
  const b = await center(to.locator(`.react-flow__handle.target[data-handleid="${toPort}"]`));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

export const savedFlow = async (page: Page) =>
  page.evaluate(async () => {
    const list = await window.api.automations.list();
    if (!list.ok) throw new Error("list");
    const res = await window.api.workflows.load({ automationId: list.data[0]!.id });
    if (!res.ok) throw new Error(res.error.message);
    return res.data;
  });

/** Cria uma automação com o fluxo Início → Esperar(seconds) → Fim já salvo (atalho para testar a execução). */
export async function seedWaitFlow(page: Page, name: string, seconds: number): Promise<void> {
  await createAutomation(page, name);
  await page.evaluate(
    async ({ name, seconds }) => {
      const list = await window.api.automations.list();
      if (!list.ok) throw new Error("list");
      const id = list.data.find((a) => a.name === name)!.id;
      const res = await window.api.workflows.save({
        automationId: id,
        document: {
          schemaVersion: 1, id, name,
          nodes: [
            { id: "start", type: "trigger.manual", version: 1, config: {} },
            { id: "w", type: "flow.wait", version: 1, config: { seconds } },
            { id: "end", type: "flow.end", version: 1, config: { message: "Pronto" } },
          ],
          edges: [
            { id: "e1", source: "start", sourceHandle: "next", target: "w", targetHandle: "input" },
            { id: "e2", source: "w", sourceHandle: "next", target: "end", targetHandle: "input" },
          ],
          variables: {},
          settings: { timeoutSeconds: 600, errorPolicy: "stop" },
          visual: { positions: { start: { x: 0, y: 100 }, w: { x: 250, y: 100 }, end: { x: 500, y: 100 } } },
        },
      });
      if (!res.ok) throw new Error(res.error.message);
    },
    { name, seconds },
  );
}

/** PID do processo do motor Python (filho direto do processo principal do Electron). Só Linux/macOS. */
export async function enginePid(app: ElectronApplication): Promise<number> {
  const main = await app.evaluate(() => process.pid);
  const out = execSync(`pgrep -P ${main} -f automation_engine`).toString().trim().split("\n")[0]!;
  return Number(out);
}

export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Espera o motor ficar "ready", consultando a API (independe da tela aberta). */
export async function waitEngineReady(page: Page, timeout = 15_000): Promise<void> {
  await expect
    .poll(async () => page.evaluate(async () => { const r = await window.api.engine.status(); return r.ok ? r.data.state : "erro"; }), { timeout })
    .toBe("ready");
}

type Cfg = Record<string, string | number | boolean | null>;
export const nodeSpec = (id: string, type: string, config: Cfg = {}) => ({ id, type, version: 1, config });
export const edgeSpec = (source: string, sourceHandle: string, target: string) => ({ id: `e:${source}.${sourceHandle}>${target}`, source, sourceHandle, target, targetHandle: "input" });

/** Cria uma automação com um fluxo qualquer já salvo. Posições são geradas em grade. */
export async function seedFlow(
  page: Page,
  name: string,
  flow: { nodes: ReturnType<typeof nodeSpec>[]; edges: ReturnType<typeof edgeSpec>[]; variables?: Record<string, { type: "string" | "number" | "boolean"; value: string | number | boolean }> },
): Promise<void> {
  await createAutomation(page, name);
  await page.evaluate(
    async ({ name, flow }) => {
      const list = await window.api.automations.list();
      if (!list.ok) throw new Error("list");
      const id = list.data.find((a) => a.name === name)!.id;
      const positions = Object.fromEntries(flow.nodes.map((n, i) => [n.id, { x: (i % 4) * 250, y: Math.floor(i / 4) * 160 }]));
      const res = await window.api.workflows.save({
        automationId: id,
        document: { schemaVersion: 1, id, name, nodes: flow.nodes, edges: flow.edges, variables: flow.variables ?? {}, settings: { timeoutSeconds: 600, errorPolicy: "stop" }, visual: { positions } } as never,
      });
      if (!res.ok) throw new Error(res.error.message);
    },
    { name, flow },
  );
}
