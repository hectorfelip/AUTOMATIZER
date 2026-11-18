import { create } from "zustand";
import type { AppInfo, Theme } from "@automation-studio/shared-types";
import { unwrap } from "../lib/api";

interface State {
  theme: Theme;
  info: AppInfo | null;
  load(): Promise<void>;
  setTheme(theme: Theme): Promise<void>;
}

export const useSettings = create<State>((set, get) => ({
  theme: "system",
  info: null,
  async load() {
    try {
      const [settings, info] = await Promise.all([unwrap((a) => a.settings.get()), unwrap((a) => a.app.info())]);
      set({ theme: settings.theme, info });
    } catch {
      /* mantém o padrão; a tela de configurações mostra o estado atual */
    }
  },
  async setTheme(theme) {
    const previous = get().theme;
    set({ theme }); // aplica na hora; reverte se não conseguir salvar
    try {
      await unwrap((a) => a.settings.update({ theme }));
    } catch (e) {
      set({ theme: previous });
      throw e;
    }
  },
}));
