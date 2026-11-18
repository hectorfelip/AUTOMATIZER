-- Fase 2: cada salvamento de um fluxo cria uma versão imutável (execuções apontarão para ela).
CREATE TABLE workflow_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id   TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  change_note     TEXT NOT NULL DEFAULT '',
  UNIQUE (automation_id, version_number)
);
