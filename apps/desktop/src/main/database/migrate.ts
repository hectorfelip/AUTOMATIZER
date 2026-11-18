import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  sql: string;
}

// Migrações vivem em /database/migrations (ARCHITECTURE.md §4), nomeadas NNNN_descricao.sql.
const files = import.meta.glob("../../../../../database/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const migrations: Migration[] = Object.entries(files)
  .map(([path, sql]) => ({ version: Number(path.split("/").pop()!.split("_")[0]), sql }))
  .sort((a, b) => a.version - b.version);

/** Aplica migrações pendentes, cada uma em transação; `user_version` guarda a versão atual. */
export function migrate(db: DatabaseSync, list: Migration[] = migrations): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (const m of list) {
    if (m.version <= row.user_version) continue;
    db.exec("BEGIN");
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Falha na migração ${m.version}: ${(err as Error).message}`);
    }
  }
}
