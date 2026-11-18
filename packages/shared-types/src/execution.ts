/** Eventos de execução enviados do Main à interface (e usados pelo interpretador). */

export type ExecutionStatus = "completed" | "failed" | "cancelled";

export interface ExecutionError {
  code: string;
  /** Segura para o usuário. */
  message: string;
  /** Técnico; não mostrar por padrão. */
  details?: Record<string, unknown>;
}

interface Base {
  executionId: string;
  /** ISO 8601 */
  at: string;
}

export type ExecutionEvent =
  | (Base & { type: "execution_started"; workflowName: string; nodeCount: number })
  | (Base & { type: "node_started"; nodeId: string; nodeType: string; label: string })
  | (Base & { type: "node_progress"; nodeId: string; percent?: number; message?: string })
  | (Base & { type: "node_completed"; nodeId: string; port: string | null; message?: string })
  | (Base & { type: "node_failed"; nodeId: string; error: ExecutionError })
  | (Base & { type: "execution_finished"; status: ExecutionStatus; durationMs: number; error?: ExecutionError; message?: string });

export interface StartExecutionResult {
  executionId: string;
}

/** Pedido de execução de uma ação, já com a config resolvida (docs/PROTOCOL.md). */
export interface ActionRequest {
  executionId: string;
  nodeId: string;
  action: string;
  config: Record<string, string | number | boolean | null>;
}

export type ActionOutcome =
  | { kind: "completed"; outputs: Record<string, unknown>; next?: string; message?: string }
  | { kind: "failed"; error: ExecutionError }
  | { kind: "cancelled" };

export interface ActionProgress {
  percent?: number;
  message?: string;
}
