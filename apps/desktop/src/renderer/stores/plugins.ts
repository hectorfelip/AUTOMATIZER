import { create } from "zustand";
import type { PluginPreview, PluginSummary } from "@automation-studio/shared-types";
import { setPluginNodes } from "@automation-studio/node-registry";
import { parsePlugin } from "@automation-studio/workflow-validator";
import { errorMessage, unwrap } from "../lib/api";

interface State {
  items: PluginSummary[];
  /** Os nós dos plugins ativos já estão no registro (o editor só abre depois disto). */
  ready: boolean;
  /** Muda a cada recarga: componentes que listam nós (paleta) se atualizam. */
  version: number;
  loadError: string | null;
  load(): Promise<void>;
  preview(): Promise<PluginPreview | null>;
  confirm(token: string): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string): Promise<void>;
}

export const usePlugins = create<State>((set, get) => ({
  items: [],
  ready: false,
  version: 0,
  loadError: null,
  async load() {
    try {
      const [items, sources] = await Promise.all([unwrap((a) => a.plugins.list()), unwrap((a) => a.plugins.sources())]);
      // o renderer valida com o MESMO código do Main: um texto que não passa nunca vira nó
      const defs = sources.flatMap((s) => {
        const p = parsePlugin(s.text);
        return p.ok ? [p.node] : [];
      });
      setPluginNodes(defs);
      set((s) => ({ items, ready: true, version: s.version + 1, loadError: null }));
    } catch (e) {
      set((s) => ({ ready: true, version: s.version + 1, loadError: errorMessage(e) }));
    }
  },
  preview: () => unwrap((a) => a.plugins.importPreview()),
  async confirm(token) {
    await unwrap((a) => a.plugins.importConfirm({ token }));
    await get().load();
  },
  async setEnabled(id, enabled) {
    await unwrap((a) => a.plugins.setEnabled({ id, enabled }));
    await get().load();
  },
  async remove(id) {
    await unwrap((a) => a.plugins.remove({ id }));
    await get().load();
  },
}));
