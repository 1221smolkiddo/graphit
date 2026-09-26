-- Extend only the schema text; canonical event rows and original triggers stay intact.
PRAGMA writable_schema = ON;
UPDATE sqlite_schema SET sql = replace(sql, '''memory.entity.linked''',
  '''memory.entity.linked'', ''code.index.started'', ''code.file.observed'', ''code.file.deleted'', ''code.index.completed'', ''code.index.failed''')
WHERE type = 'table' AND name = 'events';
PRAGMA writable_schema = RESET;

CREATE TABLE source_blobs (
  content_hash TEXT PRIMARY KEY NOT NULL CHECK (length(content_hash) = 64),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0 AND byte_length = length(content)),
  content BLOB NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER source_blobs_no_update BEFORE UPDATE ON source_blobs
BEGIN SELECT RAISE(ABORT, 'Source blobs are immutable'); END;
CREATE TRIGGER source_blobs_no_delete BEFORE DELETE ON source_blobs
BEGIN SELECT RAISE(ABORT, 'Source blobs are immutable'); END;
CREATE TRIGGER source_blobs_no_replace BEFORE INSERT ON source_blobs
WHEN EXISTS (SELECT 1 FROM source_blobs WHERE content_hash = NEW.content_hash)
BEGIN SELECT RAISE(ABORT, 'Source blobs cannot be replaced'); END;

-- All code_* tables are disposable, project-scoped projections.
CREATE TABLE code_files (
  project_id TEXT NOT NULL, path TEXT NOT NULL, file_id TEXT NOT NULL,
  content_hash TEXT NOT NULL, observation_event_id TEXT NOT NULL,
  extraction_hash TEXT NOT NULL, extraction_json TEXT NOT NULL CHECK (json_valid(extraction_json)),
  PRIMARY KEY (project_id, path)
) STRICT;
CREATE TABLE code_symbols (
  project_id TEXT NOT NULL, logical_symbol_id TEXT NOT NULL, symbol_version_id TEXT NOT NULL,
  file_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)), PRIMARY KEY (project_id, logical_symbol_id)
) STRICT;
CREATE INDEX code_symbols_name ON code_symbols(project_id, name);
CREATE TABLE code_edges (
  project_id TEXT NOT NULL, id TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
  edge_type TEXT NOT NULL, data TEXT NOT NULL CHECK (json_valid(data)), PRIMARY KEY (project_id, id)
) STRICT;
CREATE INDEX code_edges_source ON code_edges(project_id, source_id);
CREATE INDEX code_edges_target ON code_edges(project_id, target_id);
CREATE TABLE code_imports (
  project_id TEXT NOT NULL, id TEXT NOT NULL, file_id TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)), PRIMARY KEY (project_id, id)
) STRICT;
CREATE TABLE code_index_runs (
  project_id TEXT NOT NULL, index_run_id TEXT NOT NULL, started_sequence INTEGER NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)), PRIMARY KEY (project_id, index_run_id)
) STRICT;
CREATE TABLE code_projection_state (
  project_id TEXT PRIMARY KEY NOT NULL, last_event_sequence INTEGER NOT NULL,
  graph_hash TEXT NOT NULL, diagnostics_json TEXT NOT NULL CHECK (json_valid(diagnostics_json))
) STRICT;
