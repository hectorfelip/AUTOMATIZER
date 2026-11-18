import { create } from "zustand";
import { validateWorkflow, type Issue } from "@automation-studio/workflow-validator";
import type { WorkflowDocument } from "@automation-studio/workflow-schema";
import { errorMessage, unwrap } from "../lib/api";
import * as H from "../features/editor/history";

interface EditorState {
  automationId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  loadError: string | null;
  /** Versão salva carregada/gravada (0 = nunca salvo). */
  version: number;
  /** JSON do último estado salvo: "alterações não salvas" = documento atual ≠ isto. */
  savedJson: string;
  history: H.History<WorkflowDocument>;
  selectedNodes: string[];
  selectedEdges: string[];
  saving: boolean;
  saveError: string | null;

  open(automationId: string): Promise<void>;
  close(): void;
  commit(next: WorkflowDocument, key?: string): void;
  undo(): void;
  redo(): void;
  save(): Promise<boolean>;
  select(nodes: string[], edges?: string[]): void;
}

const fresh = () => ({ selectedNodes: [] as string[], selectedEdges: [] as string[], saveError: null as string | null, saving: false });
let openToken = 0;

export const useEditor = create<EditorState>((set, get) => ({
  automationId: null,
  status: "idle",
  loadError: null,
  version: 0,
  savedJson: "",
  history: H.createHistory(null as unknown as WorkflowDocument),
  ...fresh(),

  async open(automationId) {
    const token = ++openToken;
    set({ automationId, status: "loading", loadError: null, ...fresh() });
    try {
      const { document, version } = await unwrap((a) => a.workflows.load({ automationId }));
      if (token !== openToken) return; // abriu outra automação enquanto carregava
      set({ status: "ready", version, savedJson: JSON.stringify(document), history: H.createHistory(document) });
    } catch (e) {
      if (token === openToken) set({ status: "error", loadError: errorMessage(e) });
    }
  },

  close() {
    openToken++;
    set({ automationId: null, status: "idle", loadError: null, ...fresh() });
  },

  commit: (next, key) => set((s) => ({ history: H.commit(s.history, next, key ?? null), saveError: null })),
  undo: () => set((s) => ({ history: H.undo(s.history) })),
  redo: () => set((s) => ({ history: H.redo(s.history) })),
  select: (nodes, edges = []) => set({ selectedNodes: nodes, selectedEdges: edges }),

  async save() {
    const { automationId, history, saving } = get();
    if (!automationId || saving) return false;
    const document = history.present;
    set({ saving: true, saveError: null });
    try {
      const res = await unwrap((a) => a.workflows.save({ automationId, document }));
      set({ saving: false, version: res.version, savedJson: JSON.stringify(document) });
      return true;
    } catch (e) {
      set({ saving: false, saveError: errorMessage(e) });
      return false;
    }
  },
}));

// ---- derivados ----
const cache = new WeakMap<WorkflowDocument, Issue[]>();
/** Problemas do documento atual (memoizado por referência: o documento é imutável). */
export function issuesOf(doc: WorkflowDocument): Issue[] {
  let v = cache.get(doc);
  if (!v) cache.set(doc, (v = validateWorkflow(doc)));
  return v;
}

export const currentDoc = (s: EditorState): WorkflowDocument | null => (s.status === "ready" ? s.history.present : null);
// ponytail: stringify a cada mudança do store; trocar por contador de revisão se fluxos muito grandes ficarem lentos.
export const isDirty = (s: EditorState): boolean => s.status === "ready" && JSON.stringify(s.history.present) !== s.savedJson;
