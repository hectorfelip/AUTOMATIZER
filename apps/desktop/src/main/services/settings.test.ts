import { describe, expect, it } from "vitest";
import { openDatabase } from "../database/db.js";
import { createSettingsService } from "./settings.js";

describe("settings service", () => {
  it("devolve padrão quando vazio", () => {
    expect(createSettingsService(openDatabase(":memory:")).get()).toEqual({ theme: "system" });
  });

  it("persiste e atualiza", () => {
    const db = openDatabase(":memory:");
    const s = createSettingsService(db);
    expect(s.update({ theme: "dark" })).toEqual({ theme: "dark" });
    expect(createSettingsService(db).get().theme).toBe("dark");
    expect(s.update({ theme: "light" }).theme).toBe("light");
  });

  it("valor corrompido no banco cai no padrão", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO settings VALUES ('theme', '\"roxo\"', 'x')").run();
    expect(createSettingsService(db).get().theme).toBe("system");
    db.prepare("UPDATE settings SET value_json = '{quebrado'").run();
    expect(createSettingsService(db).get().theme).toBe("system");
  });
});
