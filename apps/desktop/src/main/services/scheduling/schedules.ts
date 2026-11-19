import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Schedule, ScheduleConfig, TaskState } from "@automation-studio/shared-types";
import { AppError } from "../errors.js";
import { configProblem, nextRun } from "./nextRun.js";
import type { TaskScheduler } from "./taskScheduler.js";

interface Deps {
  tasks: TaskScheduler;
  /** Executável e prefixo de argumentos que o Agendador deve chamar (o próprio app). */
  command: { file: string; baseArgs?: string[] };
  now?: () => Date;
  newId?: () => string;
}

type Row = Record<string, unknown>;
const SELECT = "SELECT s.*, a.name AS automation_name FROM schedules s JOIN automations a ON a.id = s.automation_id";

function toSchedule(r: Row): Schedule {
  return {
    id: r["id"] as string,
    automationId: r["automation_id"] as string,
    automationName: r["automation_name"] as string,
    config: JSON.parse(r["schedule_config_json"] as string) as ScheduleConfig,
    enabled: r["enabled"] === 1,
    nextRunAt: (r["next_run_at"] as string | null) ?? null,
    lastRunAt: (r["last_run_at"] as string | null) ?? null,
    lastStatus: (r["last_status"] as string | null) ?? null,
    taskState: r["task_state"] as TaskState,
    taskError: (r["task_error"] as string | null) ?? null,
  };
}

export function createScheduleService(db: DatabaseSync, { tasks, command, now = () => new Date(), newId = randomUUID }: Deps) {
  const row = (id: string): Row => {
    const r = db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as Row | undefined;
    if (!r) throw new AppError("NOT_FOUND", "Agendamento não encontrado. Ele pode ter sido excluído.");
    return r;
  };
  const get = (id: string) => toSchedule(row(id));
  const computeNext = (c: ScheduleConfig, enabled: boolean) => (enabled ? (nextRun(c, now())?.toISOString() ?? null) : null);

  /** Leva o estado desejado (banco) ao Windows e registra se deu certo. Nunca lança: falha vira `task_state = error`. */
  const sync = async (id: string): Promise<Schedule> => {
    const s = get(id);
    const res = await tasks.upsert({
      name: s.id,
      command: command.file,
      args: [...(command.baseArgs ?? []), `--run-automation=${s.automationId}`, `--schedule=${s.id}`],
      config: s.config,
      enabled: s.enabled,
    });
    const state: TaskState = res.ok ? "synced" : tasks.supported ? "error" : "unsupported";
    db.prepare("UPDATE schedules SET task_state = ?, task_error = ?, updated_at = ? WHERE id = ?").run(state, res.ok ? null : (res.message ?? null), now().toISOString(), id);
    return get(id);
  };

  const validate = (c: ScheduleConfig, existing?: ScheduleConfig) => {
    // "única" no passado só é recusada ao criar/trocar a data; reeditar outro campo de um agendamento antigo não deve falhar por isso
    const unchangedOnce = existing?.kind === "once" && c.kind === "once" && existing.at === c.at;
    const problem = unchangedOnce ? null : configProblem(c, now());
    if (problem) throw new AppError("VALIDATION", problem);
  };

  return {
    list: (automationId?: string): Schedule[] =>
      (automationId ? db.prepare(`${SELECT} WHERE s.automation_id = ? ORDER BY s.created_at, s.rowid`).all(automationId) : db.prepare(`${SELECT} ORDER BY s.created_at, s.rowid`).all()).map((r) => toSchedule(r as Row)),

    async create(automationId: string, config: ScheduleConfig): Promise<Schedule> {
      const auto = db.prepare("SELECT status, current_version FROM automations WHERE id = ?").get(automationId) as { status: string; current_version: number } | undefined;
      if (!auto) throw new AppError("NOT_FOUND", "Automação não encontrada. Ela pode ter sido excluída.");
      if (auto.current_version === 0) throw new AppError("VALIDATION", "Salve o fluxo no editor antes de agendá-lo.");
      if (auto.status === "archived") throw new AppError("VALIDATION", "Automações arquivadas não podem ser agendadas. Restaure-a primeiro.");
      validate(config);
      const id = newId();
      const ts = now().toISOString();
      db.prepare(
        "INSERT INTO schedules (id, automation_id, schedule_type, schedule_config_json, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)",
      ).run(id, automationId, config.kind, JSON.stringify(config), computeNext(config, true), ts, ts);
      return sync(id);
    },

    async update(id: string, config: ScheduleConfig): Promise<Schedule> {
      const cur = get(id);
      validate(config, cur.config);
      db.prepare("UPDATE schedules SET schedule_type = ?, schedule_config_json = ?, next_run_at = ?, updated_at = ? WHERE id = ?").run(
        config.kind,
        JSON.stringify(config),
        computeNext(config, cur.enabled),
        now().toISOString(),
        id,
      );
      return sync(id);
    },

    async setEnabled(id: string, enabled: boolean): Promise<Schedule> {
      const cur = get(id);
      if (enabled) validate(cur.config, cur.config);
      db.prepare("UPDATE schedules SET enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, computeNext(cur.config, enabled), now().toISOString(), id);
      return sync(id);
    },

    /** Tenta de novo registrar no Windows (ex.: depois de corrigir permissões). */
    resync: (id: string) => (row(id), sync(id)),

    async remove(id: string): Promise<null> {
      row(id);
      const res = await tasks.remove(id);
      if (!res.ok) throw new AppError("IO_ERROR", `${res.message ?? "Não foi possível remover a tarefa do Windows."} O agendamento foi mantido para você tentar de novo.`);
      db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
      return null;
    },

    /** Antes de excluir uma automação: retira as tarefas do Windows (as linhas saem em cascata). Falha de uma não impede as outras. */
    async removeAllFor(automationId: string): Promise<void> {
      for (const s of this.list(automationId)) await tasks.remove(s.id);
    },

    /** Chamado quando uma execução disparada por agendamento termina. Recalcula a próxima; "única" se desativa sozinha. */
    recordRun(id: string, status: string): void {
      const r = db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as Row | undefined;
      if (!r) return; // agendamento removido enquanto rodava
      const s = toSchedule(r);
      const done = s.config.kind === "once";
      const at = now();
      db.prepare("UPDATE schedules SET last_run_at = ?, last_status = ?, next_run_at = ?, enabled = ?, updated_at = ? WHERE id = ?").run(
        at.toISOString(),
        status,
        done ? null : computeNext(s.config, s.enabled),
        done ? 0 : s.enabled ? 1 : 0,
        at.toISOString(),
        id,
      );
    },

    /** Ao iniciar o app: recalcula próximas execuções (o tempo passou) e confere se o Windows ainda tem as tarefas. */
    async refresh(): Promise<void> {
      for (const s of this.list()) {
        db.prepare("UPDATE schedules SET next_run_at = ? WHERE id = ?").run(computeNext(s.config, s.enabled), s.id);
      }
    },
  };
}
export type ScheduleService = ReturnType<typeof createScheduleService>;
