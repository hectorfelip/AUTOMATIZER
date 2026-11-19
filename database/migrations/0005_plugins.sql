-- Fase 8: plugins declarativos (ADR 0014). Guarda o texto original validado; o nó é derivado dele a cada inicialização.
CREATE TABLE plugins (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  version      TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  source_json  TEXT NOT NULL,
  installed_at TEXT NOT NULL
);
