import { create } from "zustand";

/** Breakpoints são do usuário, não do fluxo: ficam só neste computador (localStorage) e não entram nas versões salvas. */
const KEY = "automation-studio.breakpoints";
type Map = Record<string, string[]>;

const read = (): Map => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Map) : {};
  } catch {
    return {};
  }
};
const write = (m: Map) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* sem armazenamento: os breakpoints valem só nesta sessão */
  }
};

export interface BreakpointState {
  byAutomation: Map;
  of(automationId: string): string[];
  toggle(automationId: string, nodeId: string): void;
  /** Descarta ids de nós que não existem mais no fluxo. */
  prune(automationId: string, existing: string[]): void;
}

export const useBreakpoints = create<BreakpointState>((set, get) => {
  const save = (automationId: string, ids: string[]) => {
    const next = { ...get().byAutomation };
    if (ids.length) next[automationId] = ids;
    else delete next[automationId];
    write(next);
    set({ byAutomation: next });
    // execução em andamento: os breakpoints valem na hora
    void import("./run").then(({ useRun }) => {
      const id = useRun.getState().executionId;
      if (id && useRun.getState().running) void window.api?.executions.setBreakpoints({ executionId: id, nodeIds: ids });
    });
  };
  return {
    byAutomation: read(),
    of: (automationId) => get().byAutomation[automationId] ?? [],
    toggle(automationId, nodeId) {
      const cur = get().of(automationId);
      save(automationId, cur.includes(nodeId) ? cur.filter((i) => i !== nodeId) : [...cur, nodeId]);
    },
    prune(automationId, existing) {
      const cur = get().of(automationId);
      const kept = cur.filter((i) => existing.includes(i));
      if (kept.length !== cur.length) save(automationId, kept);
    },
  };
});
