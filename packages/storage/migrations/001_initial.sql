CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 64),
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0 AND sequence <= 9007199254740991),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'project.created', 'session.started', 'checkpoint.created', 'session.resumed'
  )),
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  created_at TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  UNIQUE (project_id, sequence)
) STRICT;

CREATE INDEX events_session ON events (project_id, session_id, sequence);

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'Source events are immutable');
END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'Source events are immutable');
END;

CREATE TRIGGER events_sequence BEFORE INSERT ON events
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM events WHERE id = NEW.id)
    THEN RAISE(ABORT, 'Source events cannot be replaced') END;
  SELECT CASE WHEN NEW.sequence != COALESCE(
    (SELECT MAX(sequence) + 1 FROM events WHERE project_id = NEW.project_id), 1
  ) THEN RAISE(ABORT, 'Non-contiguous project sequence') END;
END;

-- All tables below are disposable projections of source events.
CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  active_session_id TEXT,
  last_sequence INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  created_at TEXT NOT NULL,
  resumed_from_checkpoint_id TEXT,
  PRIMARY KEY (project_id, id)
) STRICT;

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  through_sequence INTEGER NOT NULL,
  state_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id, session_id) REFERENCES sessions(project_id, id)
) STRICT;
