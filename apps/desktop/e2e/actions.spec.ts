import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { closeApp, edgeSpec as e, launch, newDataDir, nodeSpec as n, openEditor, seedFlow, waitEngineReady } from "./helpers";

const tmp = () => mkdtempSync(join(tmpdir(), "as-e2e-files-"));
const names = (d: string) => readdirSync(d).sort();
const runStatus = (page: Page) => page.getByTestId("run-status");

async function run(page: Page, name: string) {
  await waitEngineReady(page);
  await openEditor(page, name);
  await page.getByRole("button", { name: "Executar", exact: true }).click();
}

test("organizar arquivos: mover só os PDFs pelo app, de verdade, no disco", async () => {
  const base = tmp();
  const origem = join(base, "Downloads");
  mkdirSync(origem);
  for (const f of ["a.pdf", "b.pdf", "nota.txt"]) writeFileSync(join(origem, f), f);
  const destino = join(base, "Docs", "PDFs"); // ainda não existe

  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "Organizar", {
    nodes: [n("start", "trigger.manual"), n("pasta", "files.create_folder", { path: "{{variables.destino}}" }), n("mover", "files.move", { source: `{{variables.origem}}${sep}*.pdf`, destination: "{{variables.destino}}", overwrite: false }), n("end", "flow.end", { message: "Organizado" })],
    edges: [e("start", "next", "pasta"), e("pasta", "success", "mover"), e("mover", "success", "end")],
    variables: { origem: { type: "string", value: origem }, destino: { type: "string", value: destino } },
  });
  await run(page, "Organizar");

  await expect(runStatus(page)).toContainText("Execução concluída", { timeout: 10_000 });
  await expect(page.getByTestId("run-row-pasta")).toContainText("criada");
  await expect(page.getByTestId("run-row-mover")).toContainText("2 arquivo(s)");
  expect(names(destino)).toEqual(["a.pdf", "b.pdf"]); // moveu
  expect(names(origem)).toEqual(["nota.txt"]); // o resto ficou
  await closeApp(app);
});

test("conflito de destino: erro claro apontando o nó, e nenhum arquivo é alterado", async () => {
  const base = tmp();
  const origem = join(base, "in");
  const destino = join(base, "out");
  mkdirSync(origem);
  mkdirSync(destino);
  writeFileSync(join(origem, "a.pdf"), "novo");
  writeFileSync(join(destino, "a.pdf"), "antigo");

  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "Conflito", {
    nodes: [n("start", "trigger.manual"), n("mover", "files.move", { source: join(origem, "*.pdf"), destination: destino, overwrite: false }), n("end", "flow.end")],
    edges: [e("start", "next", "mover"), e("mover", "success", "end")],
  });
  await run(page, "Conflito");

  await expect(runStatus(page)).toContainText("Execução falhou", { timeout: 10_000 });
  const alert = page.getByRole("alert").filter({ hasText: "Mover arquivo:" });
  await expect(alert).toContainText("já existem");
  await expect(alert).toContainText("Nada foi alterado");
  await expect(page.getByTestId("run-row-mover")).toContainText("Falhou");
  expect(names(origem)).toEqual(["a.pdf"]);
  expect(names(destino)).toEqual(["a.pdf"]); // intacto (e não sobrescrito)
  await closeApp(app);
});

test("condição e repetição: o fluxo decide e repete, e o painel mostra cada decisão", async () => {
  const base = tmp();
  const existe = join(base, "existe");
  mkdirSync(existe);
  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "Decide", {
    nodes: [
      n("start", "trigger.manual"),
      n("ex", "files.exists", { path: "{{variables.pasta}}" }),
      n("r", "flow.repeat", { times: 3 }),
      n("w", "flow.wait", { seconds: 0 }),
      n("sv", "data.set_variable", { name: "situacao", value: "tem pasta" }),
      n("cond", "flow.condition", { left: "{{variables.situacao}}", operator: "contains", right: "pasta" }),
      n("sim", "flow.end", { message: "ramo verdadeiro" }),
      n("nao", "flow.end", { message: "ramo falso" }),
      n("sem", "flow.end", { message: "sem a pasta" }),
    ],
    edges: [e("start", "next", "ex"), e("ex", "true", "r"), e("ex", "false", "sem"), e("r", "body", "w"), e("w", "next", "r"), e("r", "done", "sv"), e("sv", "next", "cond"), e("cond", "true", "sim"), e("cond", "false", "nao")],
    variables: { pasta: { type: "string", value: existe } },
  });
  await run(page, "Decide");

  await expect(runStatus(page)).toContainText("Execução concluída", { timeout: 10_000 });
  await expect(page.getByTestId("run-row-ex")).toContainText("existe");
  await expect(page.getByTestId("run-row-r")).toContainText("3 repetição(ões) concluída(s).");
  await expect(page.getByTestId("run-row-sv")).toContainText("Variável “situacao” = tem pasta.");
  await expect(page.getByTestId("run-row-cond")).toContainText("contém “pasta”: verdadeiro.");
  await expect(page.getByTestId("run-row-sim")).toContainText("ramo verdadeiro");
  await expect(page.getByTestId("run-row-nao")).toHaveCount(0); // o outro ramo não rodou
  await expect(page.getByTestId("run-row-sem")).toHaveCount(0);
  await closeApp(app);
});

test("exemplo pronto pela interface: cria, abre no editor e executa", async () => {
  const { app, page } = await launch(newDataDir());
  await page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name: "Automações" }).click();
  await page.getByRole("button", { name: "Novo a partir de exemplo" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo a partir de exemplo" });
  await expect(dialog.getByText("Organizar PDFs da pasta Downloads")).toBeVisible();
  await expect(dialog.getByText("Backup condicional")).toBeVisible();
  const notepad = dialog.locator("label", { hasText: "Abrir o Bloco de Notas e digitar" });
  await expect(notepad.getByText("Somente Windows")).toBeVisible(); // avisa antes de criar

  await dialog.getByLabel(/Repetir uma ação N vezes/).check();
  await dialog.getByLabel("Nome (opcional)").fill("Meu laço");
  await dialog.getByRole("button", { name: "Criar e abrir" }).click();

  // abre direto no editor, com o fluxo do exemplo e a variável configurável
  await expect(page.getByRole("heading", { name: "Meu laço" })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(4);
  await expect(page.getByTestId("save-status")).toHaveText("Salvo (versão 1)");
  await expect(page.getByTestId("validation-summary")).toHaveText("Fluxo válido");
  await page.getByRole("tab", { name: "Variáveis" }).click();
  await expect(page.getByLabel("Valor de voltas")).toHaveValue("3");
  await page.getByLabel("Valor de voltas").fill("2"); // edita a cópia, não o exemplo

  await waitEngineReady(page);
  await page.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(runStatus(page)).toContainText("Execução concluída", { timeout: 15_000 });
  await expect(page.getByTestId("run-row-repetir")).toContainText("2 repetição(ões) concluída(s).");
  await closeApp(app);
});

test("ativar 'Sobrescrever' exige confirmação; cancelar mantém desligado", async () => {
  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "Sobrescreve", {
    nodes: [n("start", "trigger.manual"), n("mv", "files.move", { source: "/a/*.txt", destination: "/b", overwrite: false })],
    edges: [e("start", "next", "mv")],
  });
  await openEditor(page, "Sobrescreve");
  await page.locator(".react-flow__node", { hasText: "Mover arquivo" }).click();
  const box = page.getByLabel("Sobrescrever se existir");
  await expect(box).not.toBeChecked();

  await box.click(); // (não check(): o estado só muda depois da confirmação)
  const dlg = page.getByRole("dialog", { name: "Sobrescrever arquivos?" });
  await expect(dlg).toContainText("substituídos sem perguntar");
  await dlg.getByRole("button", { name: "Cancelar" }).click();
  await expect(box).not.toBeChecked(); // nada mudou
  await expect(page.getByTestId("save-status")).toHaveText("Salvo (versão 1)");

  await box.click();
  await dlg.getByRole("button", { name: "Ativar sobrescrita" }).click();
  await expect(box).toBeChecked();
  await expect(page.getByTestId("save-status")).toHaveText("● Alterações não salvas");

  await box.uncheck(); // desligar não pede confirmação
  await expect(box).not.toBeChecked();
  await expect(dlg).toBeHidden();
  await closeApp(app);
});

// ---------- etapa 2: "Para cada item" e resultado dos nós ----------
import { localizeSeparators } from "./helpers";

test("exemplo 'Organizar por tipo': cria, edita as variáveis, executa e os arquivos vão para as pastas certas", async () => {
  const base = tmp();
  const origem = join(base, "Downloads");
  mkdirSync(origem);
  for (const f of ["a.pdf", "b.pdf", "nota.txt", "foto.JPG", "LEIAME"]) writeFileSync(join(origem, f), f);
  const destino = join(base, "Organizados");

  const { app, page } = await launch(newDataDir());
  await page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name: "Automações" }).click();
  await page.getByRole("button", { name: "Novo a partir de exemplo" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo a partir de exemplo" });
  await dialog.getByLabel(/Organizar por tipo de arquivo/).check();
  await dialog.getByLabel("Nome (opcional)").fill("Por tipo");
  await dialog.getByRole("button", { name: "Criar e abrir" }).click();
  await expect(page.getByRole("heading", { name: "Por tipo" })).toBeVisible();
  await expect(page.getByTestId("validation-summary")).toHaveText("Fluxo válido"); // o exemplo já nasce válido
  await expect(page.locator(".react-flow__node")).toHaveCount(6);

  await page.getByRole("button", { name: "← Automações" }).click();
  await localizeSeparators(page, "Por tipo"); // (só fora do Windows)
  await page.getByRole("button", { name: "Abrir Por tipo" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByRole("tab", { name: "Variáveis" }).click();
  await page.getByLabel("Valor de origem").fill(origem);
  await page.getByLabel("Valor de destino").fill(destino);

  await waitEngineReady(page);
  await page.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(runStatus(page)).toContainText("Execução concluída", { timeout: 15_000 });
  await expect(page.getByTestId("run-row-cada")).toContainText("5 item(ns) processado(s).");
  expect(names(join(destino, "pdf"))).toEqual(["a.pdf", "b.pdf"]);
  expect(names(join(destino, "txt"))).toEqual(["nota.txt"]);
  expect(names(join(destino, "jpg"))).toEqual(["foto.JPG"]);
  expect(readdirSync(destino).sort()).toEqual(["LEIAME", "jpg", "pdf", "txt"]);
  expect(readdirSync(origem)).toEqual([]);
  await closeApp(app);
});

test("seletor 'Inserir…' oferece só o que existe naquele ponto do fluxo; erro de propriedade aparece antes de executar", async () => {
  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "Referências", {
    nodes: [
      n("start", "trigger.manual"),
      n("list", "files.list", { path: "/tmp", pattern: "*" }),
      n("each", "flow.foreach", { items: "", itemName: "arquivo" }),
      n("mv", "files.move", { source: "", destination: "/tmp/out" }),
      n("end", "flow.end"),
    ],
    edges: [e("start", "next", "list"), e("list", "success", "each"), e("each", "body", "mv"), e("mv", "success", "each"), e("each", "done", "end")],
    variables: { destino: { type: "string", value: "/tmp/out" } },
  });
  await openEditor(page, "Referências");
  const panel = page.getByRole("complementary", { name: "Painel lateral" }); // (o canvas também tem elementos com aria-label "Listar arquivos"...)

  // "Para cada item": o campo Lista só oferece listas de nós anteriores
  await page.locator(".react-flow__node", { hasText: "Para cada item" }).click();
  const picker = panel.getByLabel("Inserir referência em Lista");
  await expect(picker.locator("option")).toHaveText(["Inserir…", "Listar arquivos › Arquivos"]);
  await picker.selectOption({ label: "Listar arquivos › Arquivos" });
  await expect(panel.getByLabel(/^Lista/)).toHaveValue("{{nodes.list.files}}");

  // "Mover arquivo": oferece variáveis, resultados de nós anteriores e as propriedades do item com o NOME escolhido (arquivo)
  await page.locator(".react-flow__node", { hasText: "Mover arquivo" }).click();
  const origem = panel.getByLabel("Inserir referência em Origem");
  const opts = await origem.locator("option").allTextContents();
  expect(opts).toEqual(expect.arrayContaining(["destino", "Listar arquivos › Quantidade de arquivos (número)", "arquivo.name", "arquivo.path", "arquivo.extension"]));
  expect(opts).not.toContain("Arquivos"); // lista inteira não cabe num campo de texto
  expect(opts.some((o) => o.startsWith("Mover arquivo ›"))).toBe(false); // nunca o próprio nó

  // erro de digitação na propriedade: apontado ANTES de executar, com as opções válidas
  await panel.getByLabel(/^Origem/).fill("{{arquivo.pth}}");
  await page.getByRole("tab", { name: /Problemas/ }).click();
  await expect(page.getByText("O item “arquivo” não tem “pth”. Disponíveis: name, stem, extension, path, folder, size, modifiedAt.")).toBeVisible();
  await expect(page.getByTestId("validation-summary")).toContainText("erro");
  await expect(page.getByRole("button", { name: "Executar", exact: true })).toBeDisabled();

  // o item não existe fora do corpo do laço
  await page.getByRole("tab", { name: "Propriedades" }).click();
  await panel.getByLabel(/^Origem/).fill("");
  await panel.getByLabel("Inserir referência em Origem").selectOption({ label: "arquivo.path" });
  await expect(panel.getByLabel(/^Origem/)).toHaveValue("{{arquivo.path}}");
  await panel.getByLabel("Inserir referência em Origem").selectOption({ label: "arquivo.extension" }); // em texto, acrescenta
  await expect(panel.getByLabel(/^Origem/)).toHaveValue("{{arquivo.path}}{{arquivo.extension}}");
  await panel.getByLabel(/^Origem/).fill("{{arquivo.path}}");
  await page.locator(".react-flow__node", { hasText: "Listar arquivos" }).click();
  await panel.getByLabel(/^Pasta/).fill("{{arquivo.path}}");
  await page.getByRole("tab", { name: /Problemas/ }).click();
  await expect(page.getByText("só existe dentro do corpo de um “Para cada item”")).toBeVisible();

  // corrigindo, o fluxo fica válido
  await page.getByRole("tab", { name: "Propriedades" }).click();
  await panel.getByLabel(/^Pasta/).fill("/tmp");
  await expect(page.getByTestId("validation-summary")).toHaveText("Fluxo válido");
  await closeApp(app);
});
