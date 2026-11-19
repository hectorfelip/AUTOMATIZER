import type { StoredStatus } from "@automation-studio/shared-types";

export const STATUS_LABEL: Record<StoredStatus, string> = {
  running: "Em execução",
  paused: "Pausada",
  completed: "Concluída",
  completed_with_warnings: "Concluída com avisos",
  failed: "Falhou",
  cancelled: "Cancelada",
};
export const STATUS_TONE: Record<StoredStatus, "ok" | "muted" | "danger"> = {
  running: "muted",
  paused: "muted",
  completed: "ok",
  completed_with_warnings: "muted",
  failed: "danger",
  cancelled: "muted",
};
export const MODE_LABEL: Record<string, string> = { run: "Normal", step: "Passo a passo", from: "A partir de um nó" };

export const formatDuration = (ms: number | null): string => (ms === null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
export const formatWhen = (iso: string): string => new Date(iso).toLocaleString("pt-BR");
