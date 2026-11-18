import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.js";
import { migrate, migrations } from "./migrate.js";

const tables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );

describe("migrate", () => {
  it("encontra a migração inicial", () => {
    expect(migrations[0]?.version).toBe(1);
  });

  it("cria as tabelas e registra a versão", () => {
    const db = openDatabase(":memory:");
    expect(tables(db)).toEqual(expect.arrayContaining(["automations", "settings"]));
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(
      migrations.at(-1)!.version,
    );
  });

  it("é idempotente", () => {
    const db = openDatabase(":memory:");
    expect(() => migrate(db)).not.toThrow();
  });

  it("reverte migração com erro e mantém a versão anterior", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, [{ version: 1, sql: "CREATE TABLE a (x)" }]);
    expect(() =>
      migrate(db, [
        { version: 1, sql: "CREATE TABLE a (x)" },
        { version: 2, sql: "CREATE TABLE b (x); INSERT INTO inexistente VALUES (1);" },
      ]),
    ).toThrow(/migração 2/);
    expect(tables(db)).not.toContain("b");
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
  });
});
