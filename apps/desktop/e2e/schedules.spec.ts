import { expect, test, type Page } from "@playwright/test";
import { closeApp, launch, newDataDir, seedWaitFlow, waitEngineReady } from "./helpers";

const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name });

const createVia = (page: Page, name: string, config: unknown) =>
  page.evaluate(
    async ({ name, config }) => {
      const list = await window.api.automations.list();
      const id = list.ok ? list.data.find((a) => a.name === name)!.id : "";
      const r = await window.api.schedules.create({ automationId: id, config: config as never });
      if (!r.ok) throw new Error(r.error.message);
      return { automationId: id, scheduleId: r.data.id };
    },
    { name, config },
  );

const exited = (app: Awaited<ReturnType<typeof launch>>["app"]) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("o app não fechou sozinho")), 40_000);
    app.process().once("exit", () => (clearTimeout(t), resolve()));
  });

test("criar, desativar, editar e excluir agendamentos pela interface", async () => {
  const { app, page } = await launch(newDataDir());
  await seedWaitFlow(page, "Rotina", 1);
  await nav(page, "Agendamentos").click();
  await expect(page.getByText("Nenhum agendamento.")).toBeVisible();

  await page.getByRole("button", { name: "Novo agendamento" }).click();
  const dlg = page.getByRole("dialog", { name: "Novo agendamento" });
  await dlg.getByLabel("Quando").selectOption("daily");
  await dlg.getByLabel("Hora").fill("07:30");
  await dlg.getByRole("button", { name: "Agendar" }).click();

  const item = page.getByTestId("schedule-list").getByRole("listitem");
  await expect(item).toContainText("Rotina");
  await expect(item).toContainText("Todos os dias às 07:30");
  await expect(item).toContainText("Ativo");
  await expect(item).toContainText(/Próxima: \d{2}\/\d{2}\/\d{4}/);
  await expect(item).toContainText("Última: nunca");
  await expect(item).toContainText("Não registrado"); // Linux/dev: não finge ter agendado no Windows
  await expect(page.getByTestId("schedule-unsupported")).toBeVisible();

  await page.getByRole("button", { name: "Desativar agendamento de Rotina" }).click();
  await expect(item).toContainText("Desativado");
  await expect(item).toContainText("Próxima: —");

  await page.getByRole("button", { name: "Editar agendamento de Rotina" }).click();
  const edit = page.getByRole("dialog", { name: "Editar agendamento" });
  await edit.getByLabel("Quando").selectOption("weekly");
  await edit.getByLabel("Hora").fill("18:00");
  await edit.getByRole("checkbox", { name: "sábado" }).check();
  await edit.getByRole("button", { name: "Salvar" }).click();
  await expect(item).toContainText("seg, ter, qua, qui, sex, sáb às 18:00");

  await page.getByRole("button", { name: "Ativar agendamento de Rotina" }).click();
  await expect(item).toContainText("Ativo");
  await expect(item).toContainText(/Próxima: \d{2}\/\d{2}\/\d{4}/);

  await page.getByRole("button", { name: "Excluir agendamento de Rotina" }).click();
  await page.getByRole("dialog", { name: "Excluir agendamento" }).getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("Nenhum agendamento.")).toBeVisible();
  await closeApp(app);
});

test("recusas claras: horário no passado, dias vazios e fluxo nunca salvo", async () => {
  const { app, page } = await launch(newDataDir());
  await seedWaitFlow(page, "Salvo", 1);
  await page.getByRole("navigation", { name: "Principal" }).getByRole("button", { name: "Automações" }).click();
  await page.getByRole("button", { name: "Nova automação" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Nunca salvo");
  await page.getByRole("button", { name: "Criar" }).click();
  await nav(page, "Agendamentos").click();

  await page.getByRole("button", { name: "Novo agendamento" }).click();
  const dlg = page.getByRole("dialog", { name: "Novo agendamento" });
  await dlg.getByLabel("Automação").selectOption({ label: "Salvo" });
  await dlg.getByLabel("Quando").selectOption("once");
  await dlg.getByLabel("Data e hora").fill("2020-01-01T10:00");
  await dlg.getByRole("button", { name: "Agendar" }).click();
  await expect(dlg.getByRole("alert")).toContainText("futuro");

  await dlg.getByLabel("Quando").selectOption("weekly");
  for (const d of ["segunda", "terça", "quarta", "quinta", "sexta"]) await dlg.getByRole("checkbox", { name: d }).uncheck();
  await dlg.getByRole("button", { name: "Agendar" }).click();
  await expect(dlg.getByRole("alert")).toContainText("ao menos um dia");

  await dlg.getByLabel("Quando").selectOption("logon");
  await dlg.getByLabel("Automação").selectOption({ label: "Nunca salvo" });
  await dlg.getByRole("button", { name: "Agendar" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Salve o fluxo");
  expect(await page.evaluate(async () => { const r = await window.api.schedules.list(); return r.ok ? r.data.length : -1; })).toBe(0);
  await closeApp(app);
});

test("disparo pelo Agendador (linha de comando): roda a versão salva, registra no histórico e no agendamento, e o app fecha sozinho", async () => {
  const dir = newDataDir();
  const first = await launch(dir);
  await seedWaitFlow(first.page, "Noturna", 1);
  const { automationId, scheduleId } = await createVia(first.page, "Noturna", { kind: "daily", time: "03:00" });
  await closeApp(first.app);

  const run = await launch(dir, {}, [`--run-automation=${automationId}`, `--schedule=${scheduleId}`]);
  await exited(run.app); // o app abriu só para rodar e fechou ao terminar

  const after = await launch(dir);
  await waitEngineReady(after.page);
  const hist = await after.page.evaluate(async () => {
    const r = await window.api.history.list({});
    return r.ok ? r.data.items.map((i) => ({ mode: i.mode, status: i.status, name: i.workflowName })) : [];
  });
  expect(hist).toEqual([{ mode: "scheduled", status: "completed", name: "Noturna" }]);
  await nav(after.page, "Agendamentos").click();
  const item = after.page.getByTestId("schedule-list").getByRole("listitem");
  await expect(item).toContainText(/Última: \d{2}\/\d{2}\/\d{4}.*Concluída/);
  await nav(after.page, "Histórico").click();
  await after.page.getByTestId("history-list").getByRole("button", { name: /Noturna/ }).click();
  await expect(after.page.getByTestId("history-detail")).toContainText("Agendada");
  await expect(after.page.getByTestId("history-logs")).toContainText("Execução iniciada pelo agendamento.");
  await closeApp(after.app);
});

test("agendamento desativado ou excluído não executa nada: o app registra o motivo e fecha", async () => {
  const dir = newDataDir();
  const first = await launch(dir);
  await seedWaitFlow(first.page, "Pausada", 1);
  const { automationId, scheduleId } = await createVia(first.page, "Pausada", { kind: "logon" });
  await first.page.evaluate(async (id) => void (await window.api.schedules.setEnabled({ id, enabled: false })), scheduleId);
  await closeApp(first.app);

  const run = await launch(dir, {}, [`--run-automation=${automationId}`, `--schedule=${scheduleId}`]);
  await exited(run.app);

  const after = await launch(dir);
  const state = await after.page.evaluate(async () => {
    const h = await window.api.history.list({});
    const s = await window.api.schedules.list();
    return { executions: h.ok ? h.data.total : -1, last: s.ok ? s.data[0]!.lastStatus : null };
  });
  expect(state).toEqual({ executions: 0, last: "skipped_disabled" });
  await closeApp(after.app);
});

test("argumentos malformados nunca executam nada: o app abre normalmente", async () => {
  const { app, page } = await launch(newDataDir(), {}, ["--run-automation=abc;calc", "--schedule=../x"]);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await new Promise((r) => setTimeout(r, 1500));
  expect(await page.evaluate(async () => { const h = await window.api.history.list({}); return h.ok ? h.data.total : -1; })).toBe(0);
  await closeApp(app);
});
