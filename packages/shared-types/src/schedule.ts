/** Agendamentos (Fase 6b). Horários são sempre locais do computador; quem dispara é o Agendador de Tarefas do Windows. */

export type ScheduleKind = "once" | "daily" | "weekly" | "logon";

export type ScheduleConfig =
  | { kind: "once"; /** "AAAA-MM-DDTHH:mm" (local) */ at: string }
  | { kind: "daily"; /** "HH:mm" */ time: string }
  | { kind: "weekly"; time: string; /** 0 = domingo … 6 = sábado */ days: number[] }
  | { kind: "logon" };

/** Estado do registro no Windows: o banco guarda o que o usuário quer; isto diz se o sistema operacional já sabe. */
export type TaskState = "synced" | "error" | "unsupported";

export interface Schedule {
  id: string;
  automationId: string;
  automationName: string;
  config: ScheduleConfig;
  enabled: boolean;
  /** ISO; null = não há próxima (única já passou, desativado ou "ao entrar"). */
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** Como terminou a última execução disparada por este agendamento. */
  lastStatus: string | null;
  taskState: TaskState;
  taskError: string | null;
}

export interface CreateScheduleInput {
  automationId: string;
  config: ScheduleConfig;
}
export interface UpdateScheduleInput {
  id: string;
  config: ScheduleConfig;
}
export interface ScheduleIdInput {
  id: string;
}
export interface SetScheduleEnabledInput {
  id: string;
  enabled: boolean;
}
