import { create } from "zustand";
import type { Schedule, ScheduleConfig } from "@automation-studio/shared-types";
import { errorMessage, unwrap } from "../lib/api";

interface State {
  items: Schedule[];
  loaded: boolean;
  loadError: string | null;
  load(): Promise<void>;
  create(automationId: string, config: ScheduleConfig): Promise<void>;
  update(id: string, config: ScheduleConfig): Promise<void>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  resync(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Mutações lançam Error (a tela mostra a mensagem) e recarregam a lista do Main, a fonte da verdade. */
export const useSchedules = create<State>((set, get) => {
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
        set({ items: await unwrap((a) => a.schedules.list()), loaded: true, loadError: null });
      } catch (e) {
        set({ loaded: true, loadError: errorMessage(e) });
      }
    },
    create: (automationId, config) => mutate((a) => a.schedules.create({ automationId, config })),
    update: (id, config) => mutate((a) => a.schedules.update({ id, config })),
    setEnabled: (id, enabled) => mutate((a) => a.schedules.setEnabled({ id, enabled })),
    resync: (id) => mutate((a) => a.schedules.resync({ id })),
    remove: (id) => mutate((a) => a.schedules.remove({ id })),
  };
});
