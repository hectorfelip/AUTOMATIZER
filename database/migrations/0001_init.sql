-- Fase 1: automações e configurações. Demais tabelas (workflow_versions,
-- executions, execution_logs, schedules) entram em migrações das fases que as usam.
CREATE TABLE automations (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  icon            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  current_version INTEGER NOT NULL DEFAULT 0, -- 0 = ainda sem versão de workflow
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
