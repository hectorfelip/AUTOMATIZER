import { expect, test, type Page } from "@playwright/test";
import { closeApp, edgeSpec as e, launch, newDataDir, node, nodeSpec as n, openEditor, seedFlow, waitEngineReady } from "./helpers";

const runStatus = (page: Page) => page.getByTestId("run-status");
const idOf = (page: Page, name: string) =>
  page.evaluate(async (name) => {
    const l = await window.api.automations.list();
    return l.ok ? l.data.find((a) => a.name === name)!.id : "";
  }, name);

const SOMA = {
  nodes: [n("start", "trigger.manual"), n("set", "data.set_variable", { name: "total", value: "{{variables.a}}" }), n("end", "flow.end")],
  edges: [e("start", "next", "set"), e("set", "next", "end")],
  variables: { a: { type: "number" as const, value: 1 }, total: { type: "number" as const, value: 0 } },
};

test("chamar outro fluxo: passa parâmetro, recebe o retorno, mostra os nós internos e grava tudo no histórico", async () => {
  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "Soma", SOMA);
  const somaId = await idOf(page, "Soma");
  await seedFlow(page, "Principal", {
    nodes: [
      n("start", "trigger.manual"),
      n("chama", "flow.subflow", { automationId: somaId, "arg.a": "{{variables.x}}" }),
      n("guarda", "data.set_variable", { name: "r", value: "{{nodes.chama.outputs.total}}" }),
      n("end", "flow.end"),
    ],
    edges: [e("start", "next", "chama"), e("chama", "success", "guarda"), e("guarda", "next", "end")],
    variables: { x: { type: "number", value: 41 }, r: { type: "number", value: 0 } },
  });
  await waitEngineReady(page);
  await openEditor(page, "Principal");
  await page.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(runStatus(page)).toContainText("Execução concluída", { timeout: 15_000 });
  await expect(page.getByTestId("run-row-chama")).toContainText("Concluído");
  await expect(page.getByTestId("run-row-chama/set")).toContainText("Soma › Definir variável"); // nó de dentro do outro fluxo
  await expect(page.getByTestId("snap-var-r")).toContainText("41"); // parâmetro entrou, retorno saiu

  await page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name: "Histórico" }).click();
  await page.getByTestId("history-list").getByRole("button", { name: /Principal/ }).click();
  await expect(page.getByTestId("history-logs")).toContainText("Soma › Definir variável: concluído");
  await closeApp(app);
});

test("editor: escolher o fluxo mostra os parâmetros (variáveis dele) e o retorno; salvar e reabrir preserva", async () => {
  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "Soma", SOMA);
  await seedFlow(page, "Chamador", {
    nodes: [n("start", "trigger.manual"), n("chama", "flow.subflow", {}), n("end", "flow.end")],
    edges: [e("start", "next", "chama"), e("chama", "success", "end")],
  });
  await openEditor(page, "Chamador");
  await node(page, "Chamar fluxo").click();
  await expect(page.getByTestId("validation-summary")).toContainText("erro"); // fluxo a chamar é obrigatório

  await page.getByLabel(/Fluxo a chamar/).selectOption({ label: "Soma" });
  const params = page.getByTestId("subflow-params");
  await expect(params).toContainText("número · vazio mantém o padrão (1)");
  await params.getByLabel("a", { exact: true }).fill("7");
  await expect(page.getByTestId("subflow-returns")).toContainText("{{nodes.chama.outputs.total}}");
  await expect(page.getByTestId("validation-summary")).toContainText("Fluxo válido");

  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByTestId("save-status")).toContainText("Salvo");
  await page.getByRole("button", { name: "← Automações" }).click();
  await page.getByRole("button", { name: "Abrir Chamador" }).click();
  await node(page, "Chamar fluxo").click();
  await expect(page.getByTestId("subflow-params").getByLabel("a", { exact: true })).toHaveValue("7");
  await closeApp(app);
});

test("fluxo chamado arquivado: falha apontando o nó que chamou e o motivo", async () => {
  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "Soma", SOMA);
  const somaId = await idOf(page, "Soma");
  await seedFlow(page, "Chamador", {
    nodes: [n("start", "trigger.manual"), n("chama", "flow.subflow", { automationId: somaId }), n("end", "flow.end")],
    edges: [e("start", "next", "chama"), e("chama", "success", "end")],
  });
  await page.evaluate(async (id) => void (await window.api.automations.archive({ id })), somaId);
  await waitEngineReady(page);
  await openEditor(page, "Chamador");
  await page.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(runStatus(page)).toContainText("Execução falhou", { timeout: 15_000 });
  const err = page.getByTestId("run-error");
  await expect(err).toContainText("Nó que falhou: Chamar fluxo");
  await expect(err).toContainText("arquivado");
  await closeApp(app);
});

test("ciclo entre fluxos (A chama B, B chama A) para com mensagem clara em vez de rodar para sempre", async () => {
  const { app, page } = await launch(newDataDir());
  await seedFlow(page, "A", { nodes: [n("start", "trigger.manual"), n("end", "flow.end")], edges: [e("start", "next", "end")] });
  await seedFlow(page, "B", { nodes: [n("start", "trigger.manual"), n("end", "flow.end")], edges: [e("start", "next", "end")] });
  const [a, b] = [await idOf(page, "A"), await idOf(page, "B")];
  // salva A → B e B → A pela API (a UI de cada um já impede a auto-referência, mas não o ciclo indireto)
  await page.evaluate(
    async ({ a, b }) => {
      const mk = (id: string, name: string, target: string) => ({
        schemaVersion: 1 as const, id, name,
        nodes: [
          { id: "start", type: "trigger.manual", version: 1, config: {} },
          { id: "chama", type: "flow.subflow", version: 1, config: { automationId: target } },
          { id: "end", type: "flow.end", version: 1, config: {} },
        ],
        edges: [
          { id: "e1", source: "start", sourceHandle: "next", target: "chama", targetHandle: "input" },
          { id: "e2", source: "chama", sourceHandle: "success", target: "end", targetHandle: "input" },
        ],
        variables: {}, settings: { timeoutSeconds: 600, errorPolicy: "stop" as const }, visual: { positions: {} },
      });
      for (const [id, name, t] of [[a, "A", b], [b, "B", a]] as const) {
        const r = await window.api.workflows.save({ automationId: id, document: mk(id, name, t) as never });
        if (!r.ok) throw new Error(r.error.message);
      }
    },
    { a, b },
  );
  await waitEngineReady(page);
  await openEditor(page, "A");
  await page.getByRole("button", { name: "Executar", exact: true }).click();
  await expect(runStatus(page)).toContainText("Execução falhou", { timeout: 15_000 });
  await expect(page.getByTestId("run-error")).toContainText("ciclo");
  await closeApp(app);
});
