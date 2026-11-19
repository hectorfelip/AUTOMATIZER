import { expect, test } from "@playwright/test";
import { closeApp, edgeSpec as e, launch, newDataDir, nodeSpec as n, openEditor, seedFlow, waitEngineReady } from "./helpers";

// No Linux o OCR (Windows.Media.Ocr) não existe: o importante é a FIAÇÃO app→motor e o erro claro apontando o nó.
test.skip(process.platform === "win32", "no Windows este fluxo executaria o OCR de verdade");

test("nó de visão fora do Windows: falha com mensagem clara apontando o nó (nunca exceção)", async () => {
  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "Visão", {
    nodes: [n("start", "trigger.manual"), n("ver", "vision.find_text", { text: "Salvar como", similarity: 0.8, timeoutSeconds: 2 }), n("end", "flow.end")],
    edges: [e("start", "next", "ver"), e("ver", "success", "end")],
  });
  await waitEngineReady(page);
  await openEditor(page, "Visão");
  await expect(page.getByTestId("validation-summary")).toContainText("Fluxo válido");
  await page.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(page.getByTestId("run-status")).toContainText("Execução falhou", { timeout: 15_000 });
  await expect(page.getByTestId("run-error")).toContainText("Nó que falhou: Localizar texto na tela");
  await expect(page.getByTestId("run-error")).toContainText("só funciona no Windows");
  await closeApp(app);
});

test("o nó aparece na paleta (categoria Visão) e valida os campos", async () => {
  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "Visão2", {
    nodes: [n("start", "trigger.manual"), n("ver", "vision.find_text", { text: "", similarity: 5 }), n("end", "flow.end")],
    edges: [e("start", "next", "ver"), e("ver", "success", "end")],
  });
  await openEditor(page, "Visão2");
  await expect(page.getByRole("region", { name: "Visão (OCR)" }).getByRole("button", { name: /Localizar texto na tela/ })).toBeVisible();
  await expect(page.getByTestId("validation-summary")).toContainText("2 erros"); // texto obrigatório + similaridade fora de 0,3–1
  await closeApp(app);
});

test("localizar imagem fora do Windows: falha com mensagem clara apontando o nó; campos validados", async () => {
  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "Visão A", {
    nodes: [n("start", "trigger.manual"), n("img", "vision.find_image", { imagePath: "C:\\Pasta\\botao.png", similarity: 0.9, timeoutSeconds: 2 }), n("end", "flow.end")],
    edges: [e("start", "next", "img"), e("img", "success", "end")],
  });
  await seedFlow(page, "Visão B", {
    nodes: [n("start", "trigger.manual"), n("img", "vision.find_image", { imagePath: "", similarity: 0.1 }), n("end", "flow.end")],
    edges: [e("start", "next", "img"), e("img", "success", "end")],
  });
  await waitEngineReady(page);
  await openEditor(page, "Visão A");
  await expect(page.getByTestId("validation-summary")).toContainText("Fluxo válido");
  await page.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(page.getByTestId("run-status")).toContainText("Execução falhou", { timeout: 15_000 });
  await expect(page.getByTestId("run-error")).toContainText("Nó que falhou: Localizar imagem na tela");
  await expect(page.getByTestId("run-error")).toContainText("só funciona no Windows");
  await openEditor(page, "Visão B");
  await expect(page.getByRole("region", { name: "Visão (OCR)" }).getByRole("button", { name: /Localizar imagem na tela/ })).toBeVisible();
  await expect(page.getByTestId("validation-summary")).toContainText("2 erros"); // imagem obrigatória + similaridade fora de 0,5–1
  await closeApp(app);
});
