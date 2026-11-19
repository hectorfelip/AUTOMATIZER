-- Fase 5: histórico de execuções e logs (ARCHITECTURE.md §9).
-- Guarda uma CÓPIA do fluxo executado (a execução roda o rascunho da tela, que nem sempre é uma versão salva)
-- e, quando o fluxo era idêntico a uma versão salva, o vínculo com ela.
CREATE TABLE executions (
  id                  TEXT PRIMARY KEY,
  automation_id       TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  workflow_version_id INTEGER REFERENCES workflow_versions(id) ON DELETE SET NULL,
  workflow_name       TEXT NOT NULL,
  mode                TEXT NOT NULL DEFAULT 'run',
  status              TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'completed_with_warnings', 'failed', 'cancelled')),
  started_at          TEXT NOT NULL,
  finished_at         TEXT,
  duration_ms         INTEGER,
  error_code          TEXT,
  error_message       TEXT,
  error_node_id       TEXT,
  warnings            INTEGER NOT NULL DEFAULT 0,
  definition_json     TEXT NOT NULL,
  snapshot_json       TEXT
);
CREATE INDEX idx_executions_automation ON executions (automation_id, started_at DESC);
CREATE INDEX idx_executions_started ON executions (started_at DESC);

CREATE TABLE execution_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id    TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  timestamp       TEXT NOT NULL,
  level           TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  node_id         TEXT,
  message         TEXT NOT NULL,
  details_json    TEXT,
  diagnostic_path TEXT
);
CREATE INDEX idx_logs_execution ON execution_logs (execution_id, seq);
