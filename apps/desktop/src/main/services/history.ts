import type { DatabaseSync } from "node:sqlite";
import type {
  ClearHistoryInput,
  ContextSnapshot,
  ExecutionDetail,
  ExecutionError,
  ExecutionSummary,
  HistoryFilters,
  HistoryPage,
  HistoryStats,
  LogEntry,
  LogLevel,
  StoredStatus,
} from "@automation-studio/shared-types";
import type { WorkflowDocument } from "@automation-studio/workflow-schema";
import { AppError } from "./errors.js";

interface Deps {
  now?: () => string;
  /** Apaga arquivos de diagnóstico (capturas de tela). Padrão: não faz nada (testes). */
  removeFiles?: (paths: string[]) => void;
  /** Quantas execuções guardar; ao passar, as mais antigas (já terminadas) saem. */
  maxExecutions?: number;
  /** Máximo de linhas de log por execução; erros sempre são gravados. */
  maxLogsPerExecution?: number;
}

export interface LogInput {
  level: LogLevel;
  message: string;
  nodeId?: string | null;
  details?: Record<string, unknown>;
  diagnosticPath?: string;
  at?: string;
}

export interface BeginInput {
  executionId: string;
  automationId: string;
  workflowVersionId: number | null;
  document: WorkflowDocument;
  mode: string;
  startedAt?: string;
}

export interface FinishInput {
  status: Exclude<StoredStatus, "running" | "paused">;
  durationMs: number;
  error?: ExecutionError;
  failedNodeId?: string;
  warnings?: number;
  snapshot?: ContextSnapshot;
  at?: string;
}

const MAX_MESSAGE = 2000;
const MAX_DETAILS_BYTES = 20_000;
const MAX_SNAPSHOT_BYTES = 200_000;
const FINAL = "('running', 'paused')";

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

function toSummary(r: Row): ExecutionSummary {
  return {
    id: r["id"] as string,
    automationId: r["automation_id"] as string,
    workflowName: r["workflow_name"] as string,
    mode: r["mode"] as string,
    status: r["status"] as StoredStatus,
    startedAt: r["started_at"] as string,
    finishedAt: str(r["finished_at"]),
    durationMs: num(r["duration_ms"]),
    errorCode: str(r["error_code"]),
    errorMessage: str(r["error_message"]),
    errorNodeId: str(r["error_node_id"]),
    warnings: (r["warnings"] as number) ?? 0,
    versionNumber: num(r["version_number"]),
  };
}

const SELECT_SUMMARY = `SELECT e.*, v.version_number AS version_number FROM executions e LEFT JOIN workflow_versions v ON v.id = e.workflow_version_id`;

export function createHistoryService(db: DatabaseSync, deps: Deps = {}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const removeFiles = deps.removeFiles ?? (() => undefined);
  const maxExecutions = deps.maxExecutions ?? 2000;
  const maxLogs = deps.maxLogsPerExecution ?? 5000;
  /** Próximo `seq` e quantos logs foram descartados, por execução em andamento. */
  const counters = new Map<string, { next: number; dropped: number }>();

  const insertLog = (executionId: string, seq: number, e: LogInput): void => {
    let details: string | null = e.details ? JSON.stringify(e.details) : null;
    if (details && Buffer.byteLength(details) > MAX_DETAILS_BYTES) details = JSON.stringify({ truncado: true });
    db.prepare(
      "INSERT INTO execution_logs (execution_id, seq, timestamp, level, node_id, message, details_json, diagnostic_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(executionId, seq, e.at ?? now(), e.level, e.nodeId ?? null, e.message.slice(0, MAX_MESSAGE), details, e.diagnosticPath ?? null);
  };

  const diagnosticPaths = (where: string, ...params: (string | number)[]): string[] =>
    (db.prepare(`SELECT l.diagnostic_path AS p FROM execution_logs l JOIN executions e ON e.id = l.execution_id WHERE l.diagnostic_path IS NOT NULL AND ${where}`).all(...params) as { p: string }[]).map((r) => r.p);

  /** Guarda só as `maxExecutions` mais recentes; nunca remove uma execução em andamento. */
  const trim = (): void => {
    const total = (db.prepare("SELECT COUNT(*) AS n FROM executions").get() as { n: number }).n;
    if (total <= maxExecutions) return;
    const old = db.prepare(`SELECT id FROM executions WHERE status NOT IN ${FINAL} ORDER BY started_at ASC, rowid ASC LIMIT ?`).all(total - maxExecutions) as { id: string }[];
    deleteExecutions(old.map((o) => o.id));
  };

  const deleteExecutions = (ids: string[]): number => {
    if (ids.length === 0) return 0;
    const marks = ids.map(() => "?").join(",");
    const paths = diagnosticPaths(`e.id IN (${marks})`, ...ids);
    db.prepare(`DELETE FROM executions WHERE id IN (${marks})`).run(...ids); // os logs saem junto (ON DELETE CASCADE)
    removeFiles(paths);
    return ids.length;
  };

  return {
    begin(input: BeginInput): void {
      db.prepare(
        "INSERT INTO executions (id, automation_id, workflow_version_id, workflow_name, mode, status, started_at, definition_json) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)",
      ).run(input.executionId, input.automationId, input.workflowVersionId, input.document.name, input.mode, input.startedAt ?? now(), JSON.stringify(input.document));
      counters.set(input.executionId, { next: 1, dropped: 0 });
      trim();
    },

    log(executionId: string, e: LogInput): void {
      const c = counters.get(executionId);
      if (!c) return; // execução já encerrada ou desconhecida
      if (c.next > maxLogs && e.level !== "error") {
        c.dropped++; // acima do limite só os erros são gravados
        return;
      }
      insertLog(executionId, c.next++, e);
    },

    setStatus(executionId: string, status: "running" | "paused"): void {
      db.prepare("UPDATE executions SET status = ? WHERE id = ? AND status IN ('running', 'paused')").run(status, executionId);
    },

    finish(executionId: string, f: FinishInput): void {
      const c = counters.get(executionId);
      if (c && c.dropped > 0) {
        insertLog(executionId, c.next++, { level: "warn", message: `${c.dropped} evento(s) de log foram omitidos (limite de ${maxLogs} por execução; os erros foram mantidos).`, at: f.at });
      }
      counters.delete(executionId);
      let snapshot: string | null = f.snapshot ? JSON.stringify(f.snapshot) : null;
      if (snapshot && Buffer.byteLength(snapshot) > MAX_SNAPSHOT_BYTES) snapshot = null;
      db.prepare(
        "UPDATE executions SET status = ?, finished_at = ?, duration_ms = ?, error_code = ?, error_message = ?, error_node_id = ?, warnings = ?, snapshot_json = ? WHERE id = ?",
      ).run(f.status, f.at ?? now(), f.durationMs, f.error?.code ?? null, f.error?.message ?? null, f.failedNodeId ?? null, f.warnings ?? 0, snapshot, executionId);
    },

    list(filters: HistoryFilters = {}): HistoryPage {
      const where: string[] = [];
      const params: (string | number)[] = [];
      const add = (sql: string, ...values: string[]) => {
        where.push(sql);
        params.push(...values);
      };
      if (filters.automationId) add("e.automation_id = ?", filters.automationId);
      if (filters.statuses?.length) add(`e.status IN (${filters.statuses.map(() => "?").join(",")})`, ...filters.statuses);
      if (filters.from) add("e.started_at >= ?", filters.from);
      if (filters.to) add("e.started_at <= ?", filters.to);
      const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
      const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
      const offset = Math.max(filters.offset ?? 0, 0);
      const rows = db.prepare(`${SELECT_SUMMARY}${clause} ORDER BY e.started_at DESC, e.rowid DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Row[];
      const total = (db.prepare(`SELECT COUNT(*) AS n FROM executions e${clause}`).get(...params) as { n: number }).n;
      return { items: rows.map(toSummary), total };
    },

    get(executionId: string): ExecutionDetail {
      const row = db.prepare(`${SELECT_SUMMARY} WHERE e.id = ?`).get(executionId) as Row | undefined;
      if (!row) throw new AppError("NOT_FOUND", "Execução não encontrada. Ela pode ter sido removida do histórico.");
      let document: WorkflowDocument;
      try {
        document = JSON.parse(row["definition_json"] as string) as WorkflowDocument;
      } catch {
        throw new AppError("INVALID_DATA", "O fluxo salvo nesta execução está corrompido.");
      }
      let snapshot: ContextSnapshot | null = null;
      try {
        snapshot = row["snapshot_json"] ? (JSON.parse(row["snapshot_json"] as string) as ContextSnapshot) : null;
      } catch {
        snapshot = null;
      }
      const logs = (db.prepare("SELECT * FROM execution_logs WHERE execution_id = ? ORDER BY seq").all(executionId) as Row[]).map(
        (l): LogEntry => ({
          seq: l["seq"] as number,
          timestamp: l["timestamp"] as string,
          level: l["level"] as LogLevel,
          nodeId: str(l["node_id"]),
          message: l["message"] as string,
          details: l["details_json"] ? (JSON.parse(l["details_json"] as string) as Record<string, unknown>) : null,
          hasDiagnostic: l["diagnostic_path"] !== null,
        }),
      );
      return { summary: toSummary(row), document, snapshot, logs };
    },

    stats(sinceIso?: string): HistoryStats {
      const rows = db
        .prepare(`SELECT status, COUNT(*) AS n FROM executions WHERE status NOT IN ${FINAL}${sinceIso ? " AND started_at >= ?" : ""} GROUP BY status`)
        .all(...(sinceIso ? [sinceIso] : [])) as { status: string; n: number }[];
      const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
      const completed = by["completed"] ?? 0;
      const completedWithWarnings = by["completed_with_warnings"] ?? 0;
      const failed = by["failed"] ?? 0;
      const cancelled = by["cancelled"] ?? 0;
      return { total: completed + completedWithWarnings + failed + cancelled, completed, completedWithWarnings, failed, cancelled };
    },

    /** Caminho do arquivo de diagnóstico de uma entrada de log (só se pertencer à execução pedida). */
    diagnosticPath(executionId: string, seq: number): string | null {
      const r = db.prepare("SELECT diagnostic_path AS p FROM execution_logs WHERE execution_id = ? AND seq = ?").get(executionId, seq) as { p: string | null } | undefined;
      return r?.p ?? null;
    },

    /** Ao abrir o app: o que ficou "em execução" de uma sessão anterior foi interrompido pelo fechamento. */
    recoverInterrupted(): number {
      const rows = db.prepare(`SELECT id, started_at FROM executions WHERE status IN ${FINAL}`).all() as { id: string; started_at: string }[];
      const message = "O aplicativo foi fechado durante a execução.";
      const at = now();
      for (const r of rows) {
        const seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM execution_logs WHERE execution_id = ?").get(r.id) as { n: number }).n;
        insertLog(r.id, seq, { level: "error", message, at });
        db.prepare("UPDATE executions SET status = 'failed', finished_at = ?, duration_ms = ?, error_code = 'APP_CLOSED', error_message = ? WHERE id = ?").run(
          at,
          Math.max(0, Date.parse(at) - Date.parse(r.started_at)),
          message,
          r.id,
        );
      }
      return rows.length;
    },

    /** Apaga o histórico (todo, ou só o anterior a N dias). Nunca toca em execução em andamento. */
    clear(input: ClearHistoryInput = {}): { deleted: number } {
      const cutoff = input.olderThanDays !== undefined ? new Date(Date.parse(now()) - input.olderThanDays * 86_400_000).toISOString() : null;
      const ids = (
        db.prepare(`SELECT id FROM executions WHERE status NOT IN ${FINAL}${cutoff ? " AND started_at < ?" : ""}`).all(...(cutoff ? [cutoff] : [])) as { id: string }[]
      ).map((r) => r.id);
      return { deleted: deleteExecutions(ids) };
    },

    /** Antes de excluir uma automação: as capturas dela (as linhas saem em cascata; quem exclui apaga os arquivos depois). */
    diagnosticPathsOf(automationId: string): string[] {
      return diagnosticPaths("e.automation_id = ?", automationId);
    },
  };
}
export type HistoryService = ReturnType<typeof createHistoryService>;
