import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.js";
import { DatabaseTooNewError, migrate, migrations } from "./migrate.js";

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

  it("ATUALIZAÇÃO: banco de uma versão antiga, já com dados, sobe até a atual sem perder nada", () => {
    // simula um usuário que instalou quando só existiam as 2 primeiras migrações, e usou o app
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db, migrations.filter((m) => m.version <= 2));
    db.prepare("INSERT INTO automations (id, name, description, created_at, updated_at, current_version) VALUES ('a1', 'Antiga', 'd', 't', 't', 1)").run();
    db.prepare("INSERT INTO workflow_versions (automation_id, version_number, definition_json, created_at) VALUES ('a1', 1, '{\"x\":1}', 't')").run();
    db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('theme', '\"dark\"', 't')").run();

    migrate(db); // o app novo abre o banco antigo
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(migrations.at(-1)!.version);
    expect(tables(db)).toEqual(expect.arrayContaining(["executions", "execution_logs", "schedules"])); // tabelas novas existem
    expect(db.prepare("SELECT name, current_version FROM automations WHERE id = 'a1'").get()).toMatchObject({ name: "Antiga", current_version: 1 });
    expect(db.prepare("SELECT definition_json FROM workflow_versions WHERE automation_id = 'a1'").get()).toMatchObject({ definition_json: '{"x":1}' });
    expect(db.prepare("SELECT value_json FROM settings WHERE key = 'theme'").get()).toMatchObject({ value_json: '"dark"' });
    // e dá para usar as tabelas novas ligadas aos dados antigos
    db.prepare("INSERT INTO executions (id, automation_id, workflow_name, mode, status, started_at, definition_json) VALUES ('e1', 'a1', 'Antiga', 'run', 'completed', 't', '{}')").run();
    db.prepare("INSERT INTO schedules (id, automation_id, schedule_type, schedule_config_json, created_at, updated_at) VALUES ('s1', 'a1', 'logon', '{\"kind\":\"logon\"}', 't', 't')").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM executions").get()).toMatchObject({ n: 1 });
  });

  it("DOWNGRADE: banco de versão FUTURA é recusado sem ser alterado (não corrompe dados que esta versão não entende)", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    const future = migrations.at(-1)!.version + 5;
    db.exec(`PRAGMA user_version = ${future}`);
    db.prepare("INSERT INTO automations (id, name, description, created_at, updated_at) VALUES ('f', 'Futuro', '', 't', 't')").run();
    expect(() => migrate(db)).toThrow(DatabaseTooNewError);
    expect(() => migrate(db)).toThrow(/mais nova/);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(future);
    expect(db.prepare("SELECT name FROM automations WHERE id = 'f'").get()).toMatchObject({ name: "Futuro" });
  });
});
