import { create } from "zustand";
import type { ExecutionError, ExecutionEvent, ExecutionStatus } from "@automation-studio/shared-types";
import type { WorkflowDocument } from "@automation-studio/workflow-schema";
import { errorMessage, unwrap } from "../lib/api";

export type NodeRunState = "running" | "completed" | "failed";
export interface NodeRow {
  nodeId: string;
  label: string;
  state: NodeRunState;
  percent?: number;
  message?: string;
}
export interface RunState {
  executionId: string | null;
  running: boolean;
  workflowName: string;
  rows: NodeRow[];
  finished: { status: ExecutionStatus; durationMs: number; error?: ExecutionError; message?: string } | null;
  /** Falha ao *iniciar* (motor indisponível, fluxo inválido...). */
  startError: string | null;
  start(document: WorkflowDocument): Promise<void>;
  cancel(): Promise<void>;
  clear(): void;
  init(): () => void;
}

const idle = { executionId: null, running: false, workflowName: "", rows: [], finished: null, startError: null };

/** Aplica um evento ao estado. Função pura, testável sem Electron. */
export function reduce(s: Pick<RunState, "executionId" | "running" | "workflowName" | "rows" | "finished" | "startError">, e: ExecutionEvent) {
  if (e.type === "execution_started") {
    return { executionId: e.executionId, running: true, workflowName: e.workflowName, rows: [] as NodeRow[], finished: null, startError: null };
  }
  if (e.executionId !== s.executionId) return s; // evento de outra execução
  const upsert = (nodeId: string, patch: Partial<NodeRow>, label?: string): NodeRow[] => {
    const i = s.rows.findIndex((r) => r.nodeId === nodeId);
    if (i < 0) return [...s.rows, { nodeId, label: label ?? nodeId, state: "running", ...patch }];
    return s.rows.map((r, k) => (k === i ? { ...r, ...patch } : r));
  };
  switch (e.type) {
    case "node_started":
      return { ...s, rows: upsert(e.nodeId, { state: "running", percent: undefined, message: undefined }, e.label) };
    case "node_progress":
      return { ...s, rows: upsert(e.nodeId, { percent: e.percent, message: e.message }) };
    case "node_completed":
      return { ...s, rows: upsert(e.nodeId, { state: "completed", percent: undefined, message: e.message }) };
    case "node_failed":
      return { ...s, rows: upsert(e.nodeId, { state: "failed", percent: undefined, message: e.error.message }) };
    case "execution_finished":
      return { ...s, running: false, finished: { status: e.status, durationMs: e.durationMs, error: e.error, message: e.message } };
  }
  return s;
}

export const useRun = create<RunState>((set, get) => ({
  ...idle,
  async start(document) {
    set({ startError: null });
    try {
      await unwrap((a) => a.executions.start({ document }));
    } catch (e) {
      set({ startError: errorMessage(e) });
    }
  },
  async cancel() {
    const id = get().executionId;
    if (!id || !get().running) return;
    try {
      await unwrap((a) => a.executions.cancel({ executionId: id }));
    } catch (e) {
      set({ startError: errorMessage(e) });
    }
  },
  clear: () => set((s) => (s.running ? s : { ...idle })),
  init() {
    const off = window.api?.executions.onEvent((e) => set((s) => reduce(s, e)));
    return () => off?.();
  },
}));
