/** Eventos de execução enviados do Main à interface (e usados pelo interpretador). */

/** `completed_with_warnings`: terminou, mas algum nó falhou e foi ignorado (política "continuar"). */
export type ExecutionStatus = "completed" | "completed_with_warnings" | "failed" | "cancelled";

/** Valor inteligível e limitado (texto truncado, listas e objetos resumidos) para mostrar na interface. */
export type Preview = string | number | boolean | null | { type: "list"; count: number; items: Preview[] } | { type: "object"; fields: Record<string, Preview> };

/** Foto do contexto de uma execução: variáveis, resultados dos nós e itens dos laços ativos. */
export interface ContextSnapshot {
  variables: Record<string, string | number | boolean>;
  results: { nodeId: string; label: string; outputs: Record<string, Preview> }[];
  loops: { name: string; index: number; count: number; item: Preview }[];
}

export type PauseReason = "breakpoint" | "step" | "user" | "start";
export type ExecutionMode = "run" | "step" | "from";

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
  | (Base & { type: "execution_started"; workflowName: string; nodeCount: number; mode: ExecutionMode; startNodeId?: string })
  | (Base & { type: "node_started"; nodeId: string; nodeType: string; label: string })
  | (Base & { type: "node_progress"; nodeId: string; percent?: number; message?: string })
  | (Base & { type: "node_completed"; nodeId: string; port: string | null; message?: string })
  | (Base & { type: "node_failed"; nodeId: string; error: ExecutionError; /** O fluxo seguiu mesmo assim: pela saída de erro ou pela política "continuar". */ handled?: "error_branch" | "continued" })
  | (Base & { type: "execution_pause_requested"; nodeId: string | null })
  | (Base & { type: "execution_paused"; nodeId: string; label: string; reason: PauseReason; snapshot: ContextSnapshot })
  | (Base & { type: "execution_resumed" })
  | (Base & {
      type: "execution_finished";
      status: ExecutionStatus;
      durationMs: number;
      error?: ExecutionError;
      message?: string;
      /** Nó que causou a falha que encerrou a execução. */
      failedNodeId?: string;
      /** Quantos nós falharam e foram ignorados (política "continuar"). */
      warnings?: number;
      snapshot?: ContextSnapshot;
    });

/** Como iniciar uma execução. */
export interface StartExecutionOptions {
  /** `step`: pausa antes de cada nó. `from`: começa em `fromNodeId` (sem o nó de início). */
  mode?: ExecutionMode;
  fromNodeId?: string;
  /** Valores iniciais das variáveis (sobrepõem os do fluxo); útil para "a partir daqui". */
  variables?: Record<string, string | number | boolean>;
  breakpoints?: string[];
}

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
