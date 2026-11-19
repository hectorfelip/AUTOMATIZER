import type { ContextSnapshot, ExecutionStatus } from "./execution.js";
import type { WorkflowDocument } from "@automation-studio/workflow-schema";

/** Estado persistido: além dos finais, `running`/`paused` para execuções em andamento. */
export type StoredStatus = ExecutionStatus | "running" | "paused";
export type LogLevel = "info" | "warn" | "error";

export interface ExecutionSummary {
  id: string;
  automationId: string;
  workflowName: string;
  mode: string;
  status: StoredStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Nó que causou a falha que encerrou a execução. */
  errorNodeId: string | null;
  warnings: number;
  /** Número da versão salva idêntica ao fluxo executado (null = rascunho que não era uma versão). */
  versionNumber: number | null;
}

export interface LogEntry {
  seq: number;
  timestamp: string;
  level: LogLevel;
  nodeId: string | null;
  message: string;
  details: Record<string, unknown> | null;
  /** Há uma captura de tela de diagnóstico para esta entrada. */
  hasDiagnostic: boolean;
}

export interface ExecutionDetail {
  summary: ExecutionSummary;
  /** O fluxo exatamente como foi executado. */
  document: WorkflowDocument;
  /** Contexto final (variáveis e resultados), útil para investigar uma falha. */
  snapshot: ContextSnapshot | null;
  logs: LogEntry[];
}

export interface HistoryFilters {
  automationId?: string;
  statuses?: StoredStatus[];
  /** ISO 8601, inclusivo. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface HistoryPage {
  items: ExecutionSummary[];
  total: number;
}

export interface HistoryStats {
  total: number;
  completed: number;
  completedWithWarnings: number;
  failed: number;
  cancelled: number;
}

export interface ClearHistoryInput {
  /** Apaga só o que começou há mais de N dias; sem isto, apaga tudo (exceto execuções em andamento). */
  olderThanDays?: number;
}
