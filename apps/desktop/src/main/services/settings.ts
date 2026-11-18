import type { DatabaseSync } from "node:sqlite";
import { THEMES, type AppSettings, type SettingsPatch } from "@automation-studio/shared-types";

const DEFAULTS: AppSettings = { theme: "system" };

export function createSettingsService(db: DatabaseSync, now: () => string = () => new Date().toISOString()) {
  const get = (): AppSettings => {
    const rows = db.prepare("SELECT key, value_json FROM settings").all() as { key: string; value_json: string }[];
    const stored = Object.fromEntries(rows.map((r) => [r.key, safeParse(r.value_json)]));
    // Valor corrompido ou desconhecido no banco cai no padrão, nunca quebra o app.
    const theme = THEMES.includes(stored.theme as never) ? (stored.theme as AppSettings["theme"]) : DEFAULTS.theme;
    return { theme };
  };

  return {
    get,
    update(patch: SettingsPatch): AppSettings {
      const upsert = db.prepare(
        "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
      );
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) upsert.run(key, JSON.stringify(value), now());
      }
      return get();
    },
  };
}
export type SettingsService = ReturnType<typeof createSettingsService>;

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}
