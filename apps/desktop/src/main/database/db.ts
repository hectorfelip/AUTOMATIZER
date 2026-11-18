import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrate.js";

/** Abre (ou cria) o banco e aplica migrações. Use ":memory:" nos testes. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}
