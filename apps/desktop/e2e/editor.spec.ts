import { expect, test } from "@playwright/test";
import { closeApp, connectNodes, createAutomation, dragToCanvas, launch, newDataDir, node, openEditor, palette, savedFlow } from "./helpers";

test("arrastar da paleta, conectar, configurar, salvar e reabrir preservando nós, conexões e posições", async () => {
  const dir = newDataDir();
  let { app, page } = await launch(dir);
  await createAutomation(page, "Fluxo A");
  await openEditor(page, "Fluxo A");
  await expect(page.getByTestId("save-status")).toHaveText("Ainda não salvo");

  await dragToCanvas(page, "Esperar", { x: 0.1, y: 0.1 });
  await dragToCanvas(page, "Fim", { x: 0.1, y: 0.8 });
  await expect(page.getByTestId("save-status")).toHaveText("● Alterações não salvas");

  await connectNodes(page, node(page, "Início manual"), "next", node(page, "Esperar"));
  await connectNodes(page, node(page, "Esperar"), "next", node(page, "Fim"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);

  // configurar o nó selecionado pelo painel de propriedades
  await node(page, "Esperar").click();
  await page.getByLabel("Segundos").fill("3");
  await expect(node(page, "Esperar")).toContainText("Segundos: 3");

  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("save-status")).toHaveText("Salvo (versão 1)");
  await expect(page.getByTestId("validation-summary")).toHaveText("Fluxo válido");

  const before = await savedFlow(page);
  expect(before.version).toBe(1);
  expect(before.document.nodes.map((n) => n.type)).toEqual(["trigger.manual", "flow.wait", "flow.end"]);
  expect(before.document.edges).toHaveLength(2);
  expect(before.document.nodes[1]!.config).toEqual({ seconds: 3 });
  expect(before.document.nodes[1]).not.toHaveProperty("position"); // visual separado da config
  await closeApp(app);

  // reabre o aplicativo
  ({ app, page } = await launch(dir));
  await openEditor(page, "Fluxo A");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await expect(page.getByTestId("save-status")).toHaveText("Salvo (versão 1)");
  await node(page, "Esperar").click();
  await expect(page.getByLabel("Segundos")).toHaveValue("3");
  const after = await savedFlow(page);
  expect(after.document).toEqual(before.document); // inclui visual.positions idênticas
  await closeApp(app);
});

test("fluxo inválido mostra erros específicos e eles somem ao corrigir", async () => {
  const { app, page } = await launch(newDataDir());
  await createAutomation(page, "Fluxo B");
  await openEditor(page, "Fluxo B");
  await dragToCanvas(page, "Mover arquivo", { x: 0.1, y: 0.15 });

  await expect(page.getByTestId("validation-summary")).toContainText("erro");
  await page.getByRole("tab", { name: /Problemas/ }).click();
  await expect(page.getByText("Mover arquivo: o campo “Origem” é obrigatório.")).toBeVisible();
  await expect(page.getByText("Mover arquivo: o campo “Destino” é obrigatório.")).toBeVisible();
  await expect(page.getByText("não é alcançado a partir do início")).toBeVisible(); // aviso

  // clicar no problema seleciona o nó e abre o painel de propriedades
  await page.getByText("o campo “Origem” é obrigatório").click();
  await expect(page.getByLabel("Origem")).toBeVisible();
  await expect(page.getByText("o campo “Origem” é obrigatório.")).toBeVisible(); // erro inline no campo

  // variável inexistente
  await page.getByLabel("Origem").fill("{{variables.pasta}}");
  await page.getByRole("tab", { name: /Problemas/ }).click();
  await expect(page.getByText("usa a variável “pasta”, que não está definida")).toBeVisible();
  // expressão não suportada (sem eval)
  await page.getByRole("tab", { name: "Propriedades" }).click();
  await page.getByLabel("Origem").fill("{{ process.exit(1) }}");
  await page.getByRole("tab", { name: /Problemas/ }).click();
  await expect(page.getByText("Expressão não suportada")).toBeVisible();

  // corrigir: declarar a variável e usá-la
  await page.getByRole("tab", { name: "Propriedades" }).click();
  await page.getByLabel("Origem").fill("{{variables.pasta}}");
  await page.getByLabel("Destino").fill("C:\\Backup");
  await page.getByRole("tab", { name: "Variáveis" }).click();
  await page.getByRole("button", { name: "Adicionar variável" }).click();
  const name = page.getByLabel("Nome da variável variavel1");
  await name.fill("pasta");
  await name.press("Enter");
  await page.getByRole("tab", { name: /Problemas/ }).click();
  await expect(page.getByText("não está definida")).toHaveCount(0);
  await expect(page.getByText("Origem” é obrigatório")).toHaveCount(0);

  // rascunho inválido ainda pode ser salvo
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("save-status")).toHaveText("Salvo (versão 1)");
  await closeApp(app);
});

test("alterações não salvas: indicador, desfazer volta ao estado salvo e guarda de saída", async () => {
  const { app, page } = await launch(newDataDir());
  await createAutomation(page, "Fluxo C");
  await openEditor(page, "Fluxo C");
  const status = page.getByTestId("save-status");
  const save = page.getByRole("button", { name: "Salvar" });
  await expect(save).toBeDisabled();

  await dragToCanvas(page, "Esperar", { x: 0.1, y: 0.15 });
  await expect(status).toHaveText("● Alterações não salvas");
  await expect(save).toBeEnabled();

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(status).toHaveText("Ainda não salvo"); // voltou ao estado salvo: não está sujo
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "Refazer" }).click();
  await expect(status).toHaveText("● Alterações não salvas");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);

  // sair com alterações: pergunta
  await page.getByRole("button", { name: "← Automações" }).click();
  const dlg = page.getByRole("dialog", { name: "Alterações não salvas" });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Continuar editando" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);

  await page.getByRole("button", { name: "← Automações" }).click();
  await dlg.getByRole("button", { name: "Descartar alterações" }).click();
  await expect(page.getByRole("heading", { name: "Automações" })).toBeVisible();

  // o descartado não foi salvo
  await openEditor(page, "Fluxo C");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);

  // "Salvar e sair" grava
  await dragToCanvas(page, "Fim", { x: 0.1, y: 0.15 });
  await page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name: "Dashboard" }).click();
  await dlg.getByRole("button", { name: "Salvar e sair" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await openEditor(page, "Fluxo C");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await closeApp(app);
});

test("duplicar, excluir e desfazer/refazer por atalho de teclado", async () => {
  const { app, page } = await launch(newDataDir());
  await createAutomation(page, "Fluxo D");
  await openEditor(page, "Fluxo D");
  await dragToCanvas(page, "Esperar", { x: 0.1, y: 0.15 });
  await connectNodes(page, node(page, "Início manual"), "next", node(page, "Esperar"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  const wait = node(page, "Esperar");
  await wait.click();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".react-flow__node")).toHaveCount(3);

  // excluir o selecionado (a cópia) e depois o original com sua conexão, tudo desfazível
  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await node(page, "Esperar").click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1); // a conexão volta junto
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".react-flow__node")).toHaveCount(2); // início + esperar (antes de duplicar)
  await closeApp(app);
});

test("conexões inválidas são bloqueadas; início é único", async () => {
  const { app, page } = await launch(newDataDir());
  await createAutomation(page, "Fluxo E");
  await openEditor(page, "Fluxo E");
  await dragToCanvas(page, "Esperar", { x: 0.1, y: 0.1 });
  await dragToCanvas(page, "Fim", { x: 0.1, y: 0.8 });
  await connectNodes(page, node(page, "Início manual"), "next", node(page, "Esperar"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  // a mesma saída não aceita um segundo caminho
  await connectNodes(page, node(page, "Início manual"), "next", node(page, "Fim"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  // nó não liga a si mesmo
  await connectNodes(page, node(page, "Esperar"), "next", node(page, "Esperar"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await expect(palette(page).getByRole("button", { name: "Início manual" })).toBeDisabled();
  await closeApp(app);
});

test("fechar a janela com alterações pergunta; descartar fecha, continuar mantém", async () => {
  const { app, page } = await launch(newDataDir());
  await createAutomation(page, "Fluxo F");
  await openEditor(page, "Fluxo F");
  await dragToCanvas(page, "Esperar", { x: 0.1, y: 0.15 });

  const answer = (choice: number) =>
    app.evaluate(({ dialog }, c) => {
      dialog.showMessageBoxSync = (() => c) as never; // responde ao diálogo nativo
    }, choice);
  const closeWindow = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());

  await answer(0); // "Continuar editando"
  await closeWindow();
  await page.waitForTimeout(500);
  expect(app.windows()).toHaveLength(1);
  await expect(page.locator(".react-flow__node")).toHaveCount(2);

  await answer(1); // "Descartar e sair"
  const closed = page.waitForEvent("close");
  await closeWindow();
  await closed;
  await app.close().catch(() => undefined);
});
