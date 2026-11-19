-- Fase 6b: agendamentos. O banco guarda o que o usuário quer; o Agendador de Tarefas do Windows dispara.
-- Colunas além das listadas em ARCHITECTURE.md §9: last_status, task_state, task_error (estado do registro no Windows).
CREATE TABLE schedules (
  id                   TEXT PRIMARY KEY,
  automation_id        TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  schedule_type        TEXT NOT NULL CHECK (schedule_type IN ('once', 'daily', 'weekly', 'logon')),
  schedule_config_json TEXT NOT NULL,
  enabled              INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_run_at          TEXT,
  last_status          TEXT,
  next_run_at          TEXT,
  task_state           TEXT NOT NULL DEFAULT 'unsupported' CHECK (task_state IN ('synced', 'error', 'unsupported')),
  task_error           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_schedules_automation ON schedules(automation_id);
