import type { ScheduleConfig } from "@automation-studio/shared-types";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

/** Valida a config (a mesma regra vale para o IPC e para o banco). Devolve a mensagem de erro ou null. */
export function configProblem(c: ScheduleConfig, now: Date = new Date()): string | null {
  switch (c.kind) {
    case "once": {
      const at = parseLocal(c.at);
      if (!at) return "Informe data e hora válidas (AAAA-MM-DD e HH:MM).";
      return at.getTime() > now.getTime() ? null : "A data e a hora precisam estar no futuro.";
    }
    case "daily":
      return TIME.test(c.time) ? null : "Informe a hora no formato HH:MM.";
    case "weekly":
      if (!TIME.test(c.time)) return "Informe a hora no formato HH:MM.";
      if (c.days.length === 0 || c.days.length > 7 || new Set(c.days).size !== c.days.length || c.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        return "Escolha ao menos um dia da semana.";
      }
      return null;
    case "logon":
      return null;
  }
}

/** "AAAA-MM-DDTHH:mm" → Date local; null se não existir (ex.: 31/02). */
export function parseLocal(s: string): Date | null {
  const m = DATETIME.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

const at = (base: Date, dayOffset: number, time: string): Date => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, h, m, 0, 0);
};

/** Próxima execução estritamente depois de `from`; null quando não há (única já passou, "ao entrar no Windows"). */
export function nextRun(c: ScheduleConfig, from: Date): Date | null {
  switch (c.kind) {
    case "once": {
      const t = parseLocal(c.at);
      return t && t.getTime() > from.getTime() ? t : null;
    }
    case "daily": {
      const today = at(from, 0, c.time);
      return today.getTime() > from.getTime() ? today : at(from, 1, c.time);
    }
    case "weekly": {
      for (let i = 0; i <= 7; i++) {
        const cand = at(from, i, c.time);
        if (c.days.includes(cand.getDay()) && cand.getTime() > from.getTime()) return cand;
      }
      return null;
    }
    case "logon":
      return null;
  }
}
