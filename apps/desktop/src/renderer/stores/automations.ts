import { create } from "zustand";
import type { Automation } from "@automation-studio/shared-types";
import { errorMessage, unwrap } from "../lib/api";

interface State {
  items: Automation[];
  loaded: boolean;
  loadError: string | null;
  load(): Promise<void>;
  create(name: string, description: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  archive(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Mutações lançam Error (a UI mostra a mensagem) e recarregam a lista do Main, a fonte da verdade. */
export const useAutomations = create<State>((set, get) => {
  const mutate = async (fn: Parameters<typeof unwrap>[0]) => {
    await unwrap(fn);
    await get().load();
  };
  return {
    items: [],
    loaded: false,
    loadError: null,
    async load() {
      try {
        set({ items: await unwrap((a) => a.automations.list()), loaded: true, loadError: null });
      } catch (e) {
        set({ loaded: true, loadError: errorMessage(e) });
      }
    },
    create: (name, description) => mutate((a) => a.automations.create({ name, description })),
    rename: (id, name) => mutate((a) => a.automations.rename({ id, name })),
    archive: (id) => mutate((a) => a.automations.archive({ id })),
    restore: (id) => mutate((a) => a.automations.restore({ id })),
    remove: (id) => mutate((a) => a.automations.delete({ id })),
  };
});
