import { create } from "zustand";
import type { EngineStatus } from "@automation-studio/shared-types";
import { unwrap } from "../lib/api";

interface State {
  status: EngineStatus | null;
  /** Busca o estado atual e passa a acompanhar mudanças. Devolve a função de limpeza. */
  init(): () => void;
}

export const useEngine = create<State>((set) => ({
  status: null,
  init() {
    // assina antes de buscar: não perde uma mudança que ocorra no meio
    const off = window.api?.engine.onStatusChange((status) => set({ status }));
    void unwrap((a) => a.engine.status()).then((status) => set((s) => (s.status ? s : { status })), () => undefined);
    return () => off?.();
  },
}));

/** Texto curto e sempre explícito (não depende só de cor). */
export function describeEngine(s: EngineStatus | null): { label: string; detail: string; ready: boolean } {
  if (!s) return { label: "Verificando…", detail: "", ready: false };
  switch (s.state) {
    case "ready":
      return { label: "Disponível", detail: `Motor ${s.engineVersion} · Python ${s.python}`, ready: true };
    case "starting":
      return { label: "Iniciando…", detail: "O motor de automação está sendo iniciado.", ready: false };
    case "restarting":
      return { label: "Reiniciando…", detail: "O motor encerrou e está sendo reiniciado.", ready: false };
    case "unavailable":
      return { label: "Indisponível", detail: s.reason, ready: false };
  }
}
