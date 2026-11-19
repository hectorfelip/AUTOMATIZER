import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkflow } from "@automation-studio/workflow-schema";
import { openDatabase } from "../../database/db.js";
import { createAutomationService } from "../automations.js";
import { createWorkflowService } from "../workflows.js";
import { createScheduleService } from "./schedules.js";
import type { TaskResult, TaskSpec } from "./taskScheduler.js";

let clock: Date;
let upserts: TaskSpec[];
let removed: string[];
let upsertResult: TaskResult;
let removeResult: TaskResult;
let supported: boolean;

const setup = () => {
  const db = openDatabase(":memory:");
  const automations = createAutomationService(db);
  const workflows = createWorkflowService(db);
  const a = automations.create({ name: "Rotina", description: "" });
  workflows.save(a.id, createEmptyWorkflow(a.id, "Rotina"));
  let n = 0;
  const tasks = {
    get supported() {
      return supported;
    },
    upsert: async (s: TaskSpec) => (upserts.push(s), upsertResult),
    remove: async (name: string) => (removed.push(name), removeResult),
  };
  const svc = createScheduleService(db, { tasks, command: { file: "C:\\app.exe" }, now: () => clock, newId: () => `sch-${++n}` });
  return { db, automations, workflows, svc, a };
};

beforeEach(() => {
  clock = new Date(2026, 2, 10, 10, 0);
  upserts = [];
  removed = [];
  upsertResult = { ok: true };
  removeResult = { ok: true };
  supported = true;
});

describe("agendamentos", () => {
  it("cria, mostra próxima execução e registra a tarefa com os argumentos certos", async () => {
    const { svc, a } = setup();
    const s = await svc.create(a.id, { kind: "daily", time: "07:00" });
    expect(s).toMatchObject({ id: "sch-1", automationName: "Rotina", enabled: true, taskState: "synced", taskError: null, lastRunAt: null });
    expect(new Date(s.nextRunAt!).getHours()).toBe(7);
    expect(upserts[0]).toMatchObject({ name: "sch-1", command: "C:\\app.exe", args: [`--run-automation=${a.id}`, "--schedule=sch-1"], enabled: true });
  });

  it("recusa: config inválida, automação inexistente, nunca salva, arquivada", async () => {
    const { svc, a, automations } = setup();
    await expect(svc.create(a.id, { kind: "once", at: "2026-03-10T09:00" })).rejects.toThrow(/futuro/);
    await expect(svc.create("nope", { kind: "logon" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const vazio = automations.create({ name: "Vazio", description: "" });
    await expect(svc.create(vazio.id, { kind: "logon" })).rejects.toThrow(/Salve o fluxo/);
    automations.setArchived(a.id, true);
    await expect(svc.create(a.id, { kind: "logon" })).rejects.toThrow(/arquivadas/);
    expect(svc.list()).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it("falha do Windows não perde o agendamento: fica salvo com o motivo e dá para tentar de novo", async () => {
    const { svc, a } = setup();
    upsertResult = { ok: false, message: "Acesso negado" };
    const s = await svc.create(a.id, { kind: "daily", time: "07:00" });
    expect(s).toMatchObject({ taskState: "error", taskError: "Acesso negado", enabled: true });
    upsertResult = { ok: true };
    expect(await svc.resync(s.id)).toMatchObject({ taskState: "synced", taskError: null });
  });

  it("fora do Windows o estado é 'unsupported' (não 'error'), mas o agendamento existe", async () => {
    const { svc, a } = setup();
    supported = false;
    upsertResult = { ok: false, message: "só é registrado no Windows" };
    expect(await svc.create(a.id, { kind: "daily", time: "07:00" })).toMatchObject({ taskState: "unsupported", taskError: "só é registrado no Windows" });
  });

  it("editar muda a config, recalcula a próxima e re-registra", async () => {
    const { svc, a } = setup();
    const s = await svc.create(a.id, { kind: "daily", time: "07:00" });
    const u = await svc.update(s.id, { kind: "weekly", time: "18:30", days: [1, 5] });
    expect(u.config).toEqual({ kind: "weekly", time: "18:30", days: [1, 5] });
    expect(new Date(u.nextRunAt!).getHours()).toBe(18);
    expect(upserts.at(-1)!.config).toMatchObject({ kind: "weekly" });
    await expect(svc.update(s.id, { kind: "daily", time: "99:99" })).rejects.toThrow(/HH:MM/);
  });

  it("desativar zera a próxima execução e avisa o Windows; reativar recalcula", async () => {
    const { svc, a } = setup();
    const s = await svc.create(a.id, { kind: "daily", time: "07:00" });
    const off = await svc.setEnabled(s.id, false);
    expect(off).toMatchObject({ enabled: false, nextRunAt: null });
    expect(upserts.at(-1)!.enabled).toBe(false);
    const on = await svc.setEnabled(s.id, true);
    expect(on.nextRunAt).not.toBeNull();
    expect(upserts.at(-1)!.enabled).toBe(true);
  });

  it("excluir remove do Windows e do banco; se o Windows recusar, mantém e explica", async () => {
    const { svc, a } = setup();
    const s = await svc.create(a.id, { kind: "logon" });
    removeResult = { ok: false, message: "Acesso negado" };
    await expect(svc.remove(s.id)).rejects.toMatchObject({ code: "IO_ERROR", message: expect.stringContaining("mantido") });
    expect(svc.list()).toHaveLength(1);
    removeResult = { ok: true };
    await svc.remove(s.id);
    expect(svc.list()).toHaveLength(0);
    expect(removed).toEqual(["sch-1", "sch-1"]);
    await expect(svc.remove("sch-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("excluir a automação leva os agendamentos (cascata) e removeAllFor limpa as tarefas antes", async () => {
    const { svc, a, automations, db } = setup();
    await svc.create(a.id, { kind: "logon" });
    await svc.create(a.id, { kind: "daily", time: "07:00" });
    await svc.removeAllFor(a.id);
    expect(removed).toEqual(["sch-1", "sch-2"]);
    automations.remove(a.id);
    expect((db.prepare("SELECT COUNT(*) AS n FROM schedules").get() as { n: number }).n).toBe(0);
  });

  it("recordRun: guarda última execução/estado e recalcula a próxima; 'única' se desativa sozinha", async () => {
    const { svc, a } = setup();
    const daily = await svc.create(a.id, { kind: "daily", time: "11:00" });
    clock = new Date(2026, 2, 10, 11, 0, 5);
    svc.recordRun(daily.id, "completed");
    const d = svc.list().find((s) => s.id === daily.id)!;
    expect(d).toMatchObject({ lastStatus: "completed", enabled: true });
    expect(d.lastRunAt).toBe(clock.toISOString());
    expect(new Date(d.nextRunAt!).getDate()).toBe(11); // amanhã

    clock = new Date(2026, 2, 10, 10, 0);
    const once = await svc.create(a.id, { kind: "once", at: "2026-03-10T10:30" });
    clock = new Date(2026, 2, 10, 10, 30, 3);
    svc.recordRun(once.id, "failed");
    expect(svc.list().find((s) => s.id === once.id)).toMatchObject({ enabled: false, nextRunAt: null, lastStatus: "failed" });
    svc.recordRun("removido", "completed"); // não quebra
  });

  it("refresh recalcula próximas execuções depois que o tempo passou", async () => {
    const { svc, a } = setup();
    await svc.create(a.id, { kind: "once", at: "2026-03-10T10:30" });
    await svc.create(a.id, { kind: "daily", time: "07:00" });
    clock = new Date(2026, 2, 12, 9, 0);
    await svc.refresh();
    const [once, daily] = svc.list();
    expect(once!.nextRunAt).toBeNull();
    expect(new Date(daily!.nextRunAt!).getDate()).toBe(13);
  });
});
