import type { Schedule, ScheduleConfig } from "@automation-studio/shared-types";
import { STATUS_LABEL } from "./status";

export const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
const SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

const fmtLocal = (s: string) => {
  const [d, t] = s.split("T") as [string, string];
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y} às ${t}`;
};

export function describeConfig(c: ScheduleConfig): string {
  switch (c.kind) {
    case "once":
      return `Uma vez, em ${fmtLocal(c.at)}`;
    case "daily":
      return `Todos os dias às ${c.time}`;
    case "weekly":
      return `${[...c.days].sort().map((d) => SHORT[d]).join(", ")} às ${c.time}`;
    case "logon":
      return "Ao entrar no Windows";
  }
}

const SKIPPED: Record<string, string> = {
  skipped_disabled: "Ignorada: agendamento desativado",
  skipped_missing: "Ignorada: automação excluída",
  skipped_archived: "Ignorada: automação arquivada",
  skipped_busy: "Ignorada: já havia uma execução em andamento",
  skipped_unsaved: "Ignorada: fluxo nunca salvo",
  failed_engine: "Não rodou: motor indisponível",
  failed_start: "Não rodou: o fluxo não pôde ser iniciado",
};
export const describeLastStatus = (s: string | null): string =>
  s === null ? "" : (SKIPPED[s] ?? (s in STATUS_LABEL ? STATUS_LABEL[s as keyof typeof STATUS_LABEL] : s));

export const taskStateLabel = (s: Schedule): { text: string; tone: "ok" | "muted" | "danger" } =>
  s.taskState === "synced" ? { text: "Registrado no Windows", tone: "ok" } : s.taskState === "error" ? { text: "Erro no Windows", tone: "danger" } : { text: "Não registrado (só salvo)", tone: "muted" };
