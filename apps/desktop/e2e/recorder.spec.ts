import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeApp, launch, newDataDir } from "./helpers";

// No Linux a captura real de teclado/mouse não existe: o processo gravador REAL roda com uma fonte falsa de eventos brutos
// (só com AUTOMATION_ENGINE_TEST_ACTIONS=1). O que se valida aqui é o app inteiro em volta: processo, privacidade, revisão e criação.
test.skip(process.platform === "win32", "no Windows este teste usaria o teclado de verdade");

const SECRET = "SenhaSuperSecreta99";
const key = (k: string, ms: number) => [{ k: "press", key: k, ms }, { k: "release", key: k, ms: ms + 5 }];
const typed = (text: string, from: number) => [...text].flatMap((c, i) => key(c, from + i * 80));
const ctrlAlt = (k: string, ms: number) => [{ k: "press", key: "ctrl", ms }, { k: "press", key: "alt", ms }, ...key(k, ms + 1), { k: "release", key: "alt", ms: ms + 8 }, { k: "release", key: "ctrl", ms: ms + 9 }];

function fakeEvents() {
  const raws = [
    { k: "click", x: 900, y: 700, button: "left", pressed: true, ms: 100 },
    ...typed("usuario", 3000),
    ...key("tab", 4000),
    ...ctrlAlt("s", 4100), // liga o modo senha
    ...typed(SECRET, 4300),
    ...ctrlAlt("s", 6000), // desliga
    ...key("enter", 6200),
    ...ctrlAlt("r", 6500), // para
  ];
  const p = join(mkdtempSync(join(tmpdir(), "as-e2e-rec-")), "events.json");
  writeFileSync(p, JSON.stringify(raws));
  return p;
}
const env = () => ({ AUTOMATION_ENGINE_TEST_ACTIONS: "1", AUTOMATION_RECORDER_FAKE: fakeEvents() });
const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name });

test("gravar → revisar (editar, apagar) → criar a automação; senha nunca é gravada; nada executa", async () => {
  const dir = newDataDir();
  const { app, page } = await launch(dir, env());
  await nav(page, "Gravador").click();
  await page.getByRole("button", { name: "Iniciar gravação" }).click();

  // a revisão aparece sozinha (parou pelo atalho global Ctrl+Alt+R)
  const review = page.getByTestId("review-panel");
  await expect(review).toBeVisible({ timeout: 20_000 });
  const steps = page.getByTestId("steps").getByRole("listitem");
  await expect(steps).toHaveCount(6); // clique, espera, texto, tab, texto sensível, enter
  await expect(steps.nth(0)).toContainText("Clique esquerdo em (900, 700)");
  await expect(steps.nth(1)).toContainText("Esperar 3 s");
  await expect(steps.nth(2)).toContainText("Digitar texto");
  await expect(page.getByLabel("Texto do passo s3")).toHaveValue("usuario");
  await expect(steps.nth(3)).toContainText("Atalho tab");
  await expect(page.getByTestId("step-s5")).toContainText("Digitar texto sensível");
  await expect(page.getByTestId("step-s5")).toContainText("Nada foi gravado");
  await expect(steps.nth(5)).toContainText("Atalho enter");

  // PRIVACIDADE: a senha digitada não existe em lugar nenhum da tela
  expect(await page.content()).not.toContain(SECRET);

  // edita (X do clique, texto), apaga a espera e cria
  await page.getByLabel("X do passo s1").fill("700");
  await page.getByLabel("Texto do passo s3").fill("meu usuario");
  await page.getByRole("button", { name: "Apagar passo s2" }).click();
  await page.getByLabel("Nome da automação").fill("Login gravado");
  await page.getByRole("button", { name: "Criar automação" }).click();

  // abre no editor: fluxo válido, sem execução, variável de senha a preencher
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("validation-summary")).toContainText("Fluxo válido");
  await expect(page.locator(".react-flow__node")).toHaveCount(7); // início + 5 passos (apagamos a espera) + fim
  const doc = await page.evaluate(async () => {
    const l = await window.api.automations.list();
    const id = l.ok ? l.data.find((a) => a.name === "Login gravado")!.id : "";
    const r = await window.api.workflows.load({ automationId: id });
    const h = await window.api.history.list({});
    return { doc: r.ok ? r.data.document : null, version: r.ok ? r.data.version : 0, runs: h.ok ? h.data.total : -1 };
  });
  expect(doc.version).toBe(1);
  expect(doc.runs).toBe(0); // nunca executa sozinho
  const click = doc.doc!.nodes.find((n) => n.type === "input.click")!;
  expect(click.config).toMatchObject({ x: 700, y: 700, button: "left" });
  expect(doc.doc!.nodes.some((n) => n.type === "input.type_text" && n.config["text"] === "meu usuario")).toBe(true);
  expect(doc.doc!.nodes.some((n) => n.type === "input.type_text" && n.config["text"] === "{{variables.senha}}")).toBe(true);
  expect(doc.doc!.variables["senha"]).toEqual({ type: "string", value: "" });
  expect(JSON.stringify(doc.doc)).not.toContain(SECRET);
  await closeApp(app);

  // e nada da senha foi parar no banco de dados
  const db = readFileSync(join(dir, "automation-studio.db"));
  expect(db.includes(Buffer.from(SECRET))).toBe(false);
});

test("descartar a gravação apaga tudo e não cria automação", async () => {
  const { app, page } = await launch(newDataDir(), env());
  await nav(page, "Gravador").click();
  await page.getByRole("button", { name: "Iniciar gravação" }).click();
  await expect(page.getByTestId("review-panel")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Descartar gravação" }).click();
  await expect(page.getByRole("button", { name: "Iniciar gravação" })).toBeVisible();
  const n = await page.evaluate(async () => {
    const l = await window.api.automations.list();
    const s = await window.api.recorder.status();
    return { automations: l.ok ? l.data.length : -1, events: s.ok ? s.data.events : -1, state: s.ok ? s.data.state : "" };
  });
  expect(n).toEqual({ automations: 0, events: 0, state: "idle" });
  await closeApp(app);
});

test("passos inválidos são recusados na criação com mensagem clara (nada fica pela metade)", async () => {
  const { app, page } = await launch(newDataDir(), env());
  await nav(page, "Gravador").click();
  await page.getByRole("button", { name: "Iniciar gravação" }).click();
  await expect(page.getByTestId("review-panel")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Texto do passo s3").fill("{{variables.naoexiste}}");
  await page.getByRole("button", { name: "Criar automação" }).click();
  await expect(page.getByRole("alert")).toContainText("problema");
  const total = await page.evaluate(async () => { const l = await window.api.automations.list(); return l.ok ? l.data.length : -1; });
  expect(total).toBe(0);
  await closeApp(app);
});

test("fora do Windows (sem fonte de teste) o gravador explica que só funciona no Windows", async () => {
  const { app, page } = await launch(newDataDir());
  await nav(page, "Gravador").click();
  await page.getByRole("button", { name: "Iniciar gravação" }).click();
  await expect(page.getByRole("alert")).toContainText("só funciona no Windows");
  await closeApp(app);
});
