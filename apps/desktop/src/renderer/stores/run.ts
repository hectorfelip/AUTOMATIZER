import { create } from "zustand";
import type { ContextSnapshot, ExecutionError, ExecutionEvent, ExecutionMode, ExecutionStatus, PauseReason, StartExecutionOptions } from "@automation-studio/shared-types";
import type { WorkflowDocument } from "@automation-studio/workflow-schema";
import { errorMessage, unwrap } from "../lib/api";
import { useBreakpoints } from "./breakpoints";

export type NodeRunState = "running" | "completed" | "failed";
export interface NodeRow {
  nodeId: string;
  label: string;
  state: NodeRunState;
  percent?: number;
  message?: string;
  /** A falha foi tratada e o fluxo seguiu (saída de erro ou política "continuar"). */
  handled?: "error_branch" | "continued";
}
export interface RunView {
  executionId: string | null;
  running: boolean;
  mode: ExecutionMode;
  workflowName: string;
  rows: NodeRow[];
  /** Pausada antes deste nó. */
  paused: { nodeId: string; label: string; reason: PauseReason } | null;
  /** O usuário pediu pausa e o nó atual ainda está terminando. */
  pauseRequested: boolean;
  /** Variáveis e resultados no último ponto de pausa (ou no fim). */
  snapshot: ContextSnapshot | null;
  finished: { status: ExecutionStatus; durationMs: number; error?: ExecutionError; message?: string; failedNodeId?: string; warnings?: number } | null;
  /** Falha ao *iniciar* (motor indisponível, fluxo inválido...). */
  startError: string | null;
}
export interface RunState extends RunView {
  start(automationId: string, document: WorkflowDocument, options?: StartExecutionOptions): Promise<void>;
  cancel(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  step(): Promise<void>;
  clear(): void;
  init(): () => void;
}

const idle: RunView = { executionId: null, running: false, mode: "run", workflowName: "", rows: [], paused: null, pauseRequested: false, snapshot: null, finished: null, startError: null };

/** Aplica um evento ao estado. Função pura, testável sem Electron. */
export function reduce(s: RunView, e: ExecutionEvent): RunView {
  if (e.type === "execution_started") {
    return { ...idle, executionId: e.executionId, running: true, mode: e.mode, workflowName: e.workflowName };
  }
  if (e.executionId !== s.executionId) return s; // evento de outra execução
  const upsert = (nodeId: string, patch: Partial<NodeRow>, label?: string): NodeRow[] => {
    const i = s.rows.findIndex((r) => r.nodeId === nodeId);
    if (i < 0) return [...s.rows, { nodeId, label: label ?? nodeId, state: "running", ...patch }];
    return s.rows.map((r, k) => (k === i ? { ...r, ...patch } : r));
  };
  switch (e.type) {
    case "node_started":
      return { ...s, rows: upsert(e.nodeId, { state: "running", percent: undefined, message: undefined, handled: undefined }, e.label) };
    case "node_progress":
      return { ...s, rows: upsert(e.nodeId, { percent: e.percent, message: e.message }) };
    case "node_completed":
      return { ...s, rows: upsert(e.nodeId, { state: "completed", percent: undefined, message: e.message }) };
    case "node_failed":
      return { ...s, rows: upsert(e.nodeId, { state: "failed", percent: undefined, message: e.error.message, handled: e.handled }) };
    case "execution_pause_requested":
      return { ...s, pauseRequested: true };
    case "execution_paused":
      return { ...s, pauseRequested: false, paused: { nodeId: e.nodeId, label: e.label, reason: e.reason }, snapshot: e.snapshot };
    case "execution_resumed":
      return { ...s, paused: null };
    case "execution_finished":
      return {
        ...s,
        running: false,
        paused: null,
        pauseRequested: false,
        snapshot: e.snapshot ?? s.snapshot,
        finished: { status: e.status, durationMs: e.durationMs, error: e.error, message: e.message, failedNodeId: e.failedNodeId, warnings: e.warnings },
      };
  }
  return s;
}

/** Nó que está rodando agora (ou o pausado), para destacar no canvas. */
export const currentNodeId = (s: RunView): string | null => s.paused?.nodeId ?? s.rows.find((r) => r.state === "running")?.nodeId ?? null;

export const useRun = create<RunState>((set, get) => {
  const control = async (call: (executionId: string) => Promise<unknown>) => {
    const id = get().executionId;
    if (!id || !get().running) return;
    try {
      await call(id);
    } catch (e) {
      set({ startError: errorMessage(e) });
    }
  };
  return {
    ...idle,
    async start(automationId, document, options = {}) {
      set({ startError: null });
      try {
        const breakpoints = options.breakpoints ?? useBreakpoints.getState().of(automationId);
        await unwrap((a) => a.executions.start({ automationId, document, options: { ...options, breakpoints } }));
      } catch (e) {
        set({ startError: errorMessage(e) });
      }
    },
    cancel: () => control((executionId) => unwrap((a) => a.executions.cancel({ executionId }))),
    pause: () => control((executionId) => unwrap((a) => a.executions.pause({ executionId }))),
    resume: () => control((executionId) => unwrap((a) => a.executions.resume({ executionId }))),
    step: () => control((executionId) => unwrap((a) => a.executions.step({ executionId }))),
    clear: () => set((s) => (s.running ? s : { ...idle })),
    init() {
      const off = window.api?.executions.onEvent((e) => set((s) => reduce(s, e)));
      return () => off?.();
    },
  };
});
