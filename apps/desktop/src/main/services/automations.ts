import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Automation, AutomationStatus } from "@automation-studio/shared-types";
import { AppError } from "./errors.js";

interface Deps {
  now?: () => string;
  newId?: () => string;
}

function toAutomation(row: Record<string, unknown>): Automation {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    status: row.status as AutomationStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function createAutomationService(db: DatabaseSync, deps: Deps = {}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? randomUUID;

  const get = (id: string): Automation => {
    const row = db.prepare("SELECT * FROM automations WHERE id = ?").get(id);
    if (!row) throw new AppError("NOT_FOUND", "Automação não encontrada. Ela pode ter sido excluída.");
    return toAutomation(row);
  };

  const update = (id: string, set: string, ...params: (string | number)[]): Automation => {
    const res = db.prepare(`UPDATE automations SET ${set}, updated_at = ? WHERE id = ?`).run(...params, now(), id);
    if (res.changes === 0) throw new AppError("NOT_FOUND", "Automação não encontrada. Ela pode ter sido excluída.");
    return get(id);
  };

  return {
    list: (): Automation[] =>
      db.prepare("SELECT * FROM automations ORDER BY updated_at DESC, rowid DESC").all().map(toAutomation),

    create({ name, description }: { name: string; description: string }): Automation {
      const id = newId();
      const ts = now();
      db.prepare(
        "INSERT INTO automations (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, name, description, ts, ts);
      return get(id);
    },

    rename: (id: string, name: string) => update(id, "name = ?", name),
    setArchived: (id: string, archived: boolean) => update(id, "status = ?", archived ? "archived" : "active"),

    remove(id: string): null {
      const res = db.prepare("DELETE FROM automations WHERE id = ?").run(id);
      if (res.changes === 0) throw new AppError("NOT_FOUND", "Automação não encontrada. Ela pode ter sido excluída.");
      return null;
    },
  };
}
export type AutomationService = ReturnType<typeof createAutomationService>;
