import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { globSync } from "node:fs";
import { closeApp, edgeSpec as e, launch, newDataDir, nodeSpec as n, openEditor, seedFlow, waitEngineReady } from "./helpers";

const browser = globSync("/opt/pw-browsers/chromium-*/chrome-linux*/chrome").sort().at(-1) ?? process.env["AUTOMATION_BROWSER_PATH"];
test.skip(!browser || process.platform !== "linux", "precisa do Chromium do ambiente de teste (Linux)");

const PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Loja de teste</title></head><body>
<h1 id="t">Olá</h1><input id="nome" aria-label="Nome">
<button id="ok" onclick="document.getElementById('r').textContent='Oi, '+document.getElementById('nome').value">Enviar</button>
<div id="r"></div><ul><li class="p">Café</li><li class="p">Chá</li></ul></body></html>`;

let server: Server;
let base = "";
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(req.url === "/" ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});
test.afterAll(() => void server.close());

const env = () => ({ AUTOMATION_BROWSER_PATH: browser!, AUTOMATION_BROWSER_NO_SANDBOX: "1" });
const runStatus = (page: Page) => page.getByTestId("run-status");
const chromiumProcs = () => Number(execSync("pgrep -fc playwright_chromiumdev_profile || true").toString().trim() || 0);

test("fluxo web de ponta a ponta: abre, preenche, clica, extrai e usa o resultado; o navegador fecha ao fim", async () => {
  const before = chromiumProcs();
  const { app, page } = await launch(newDataDir(), env());
  await seedFlow(page, "Web", {
    nodes: [
      n("start", "trigger.manual"),
      n("abrir", "web.navigate", { url: "{{variables.site}}", timeoutSeconds: 20 }),
      n("nome", "web.fill", { selector: "#nome", text: "Hector" }),
      n("enviar", "web.click", { selector: "role=button[name='Enviar']" }),
      n("lerRes", "web.extract", { selector: "#r" }),
      n("itens", "web.extract", { selector: ".p" }),
      n("guardar", "data.set_variable", { name: "saida", value: "{{nodes.lerRes.text}} / {{nodes.itens.count}} produtos" }),
      n("end", "flow.end", { message: "fim" }),
    ],
    edges: [e("start", "next", "abrir"), e("abrir", "success", "nome"), e("nome", "success", "enviar"), e("enviar", "success", "lerRes"), e("lerRes", "success", "itens"), e("itens", "success", "guardar"), e("guardar", "next", "end")],
    variables: { site: { type: "string", value: base }, saida: { type: "string", value: "" } },
  });
  await waitEngineReady(page);
  await openEditor(page, "Web");
  await page.getByRole("button", { name: "Executar", exact: true }).click();

  await expect(runStatus(page)).toContainText("Execução concluída", { timeout: 40_000 });
  await expect(page.getByTestId("run-row-abrir")).toContainText("Loja de teste");
  await expect(page.getByTestId("run-row-nome")).not.toContainText("Hector"); // o texto digitado não vai para a tela/log
  await expect(page.getByTestId("snap-var-saida")).toContainText("Oi, Hector / 2 produtos"); // extraído da página e usado adiante
  await expect.poll(chromiumProcs, { timeout: 10_000 }).toBe(before); // fechou sozinho ao fim da execução

  // o histórico do nó de preenchimento também não guarda o texto digitado
  const detail = await page.evaluate(async () => {
    const l = await window.api.history.list({});
    const id = l.ok ? l.data.items[0]!.id : "";
    const d = await window.api.history.get({ executionId: id });
    return d.ok ? JSON.stringify(d.data.logs.filter((x) => x.nodeId === "nome")) : "";
  });
  expect(detail).toContain("Preenchi");
  expect(detail).not.toContain("Hector"); // o log do nó de preenchimento não repete o texto digitado
  await closeApp(app);
});

test("falhas web apontam o nó e a causa: elemento inexistente e página com erro", async () => {
  const { app, page } = await launch(newDataDir(), env());
  await seedFlow(page, "Web falha", {
    nodes: [n("start", "trigger.manual"), n("abrir", "web.navigate", { url: base, timeoutSeconds: 20 }), n("clicar", "web.click", { selector: "#nao-existe", timeoutSeconds: 1 }), n("end", "flow.end")],
    edges: [e("start", "next", "abrir"), e("abrir", "success", "clicar"), e("clicar", "success", "end")],
  });
  await waitEngineReady(page);
  await openEditor(page, "Web falha");
  await page.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(runStatus(page)).toContainText("Execução falhou", { timeout: 40_000 });
  const err = page.getByTestId("run-error");
  await expect(err).toContainText("Nó que falhou: Clicar no elemento");
  await expect(err).toContainText("#nao-existe");
  await closeApp(app);
});

test("cancelar uma espera web longa responde rápido e o navegador fecha", async () => {
  const before = chromiumProcs();
  const { app, page } = await launch(newDataDir(), env());
  await seedFlow(page, "Web espera", {
    nodes: [n("start", "trigger.manual"), n("abrir", "web.navigate", { url: base }), n("esperar", "web.wait", { selector: "#nunca", timeoutSeconds: 120 }), n("end", "flow.end")],
    edges: [e("start", "next", "abrir"), e("abrir", "success", "esperar"), e("esperar", "success", "end")],
  });
  await waitEngineReady(page);
  await openEditor(page, "Web espera");
  await page.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(page.getByTestId("run-row-esperar")).toContainText("Executando…", { timeout: 30_000 });
  const t0 = Date.now();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(runStatus(page)).toContainText("Execução cancelada", { timeout: 5000 });
  expect(Date.now() - t0).toBeLessThan(4000);
  await expect.poll(chromiumProcs, { timeout: 10_000 }).toBe(before);
  await closeApp(app);
});
