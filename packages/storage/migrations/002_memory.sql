-- Widen only the event-type CHECK using SQLite's documented schema-text procedure.
-- No source rows, indexes, or immutability triggers are rewritten or dropped.
-- The runner verifies the expected definition and integrity inside this transaction.
PRAGMA writable_schema = ON;
UPDATE sqlite_schema SET sql = replace(sql,
  '''project.created'', ''session.started'', ''checkpoint.created'', ''session.resumed''',
  '''project.created'', ''session.started'', ''checkpoint.created'', ''session.resumed'',
    ''conversation.user_message'', ''conversation.assistant_message'', ''tool.call'', ''tool.result'',
    ''command.executed'', ''command.result'', ''file.changed'', ''test.result'',
    ''memory.entity.created'', ''memory.entity.status_changed'', ''memory.entity.superseded'', ''memory.entity.linked'''
) WHERE type = 'table' AND name = 'events';
PRAGMA writable_schema = RESET;

ALTER TABLE sessions ADD COLUMN provider TEXT;
ALTER TABLE sessions ADD COLUMN agent_name TEXT;
ALTER TABLE sessions ADD COLUMN model_name TEXT;
ALTER TABLE sessions ADD COLUMN external_session_id TEXT;
ALTER TABLE sessions ADD COLUMN client_name TEXT;

CREATE TABLE memory_entities (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('goal','task','decision','constraint','blocker','question','action','result','artifact')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','in_progress','completed','resolved','cancelled','superseded')),
  created_at TEXT NOT NULL,
  source_event_ids TEXT NOT NULL CHECK (json_valid(source_event_ids) AND json_array_length(source_event_ids) > 0),
  created_by_session_id TEXT NOT NULL,
  valid_from_sequence INTEGER NOT NULL,
  valid_to_sequence INTEGER,
  superseded_by TEXT,
  metadata TEXT NOT NULL CHECK (json_valid(metadata) AND json_type(metadata) = 'object'),
  PRIMARY KEY (project_id, id)
) STRICT;

CREATE INDEX memory_entities_filter ON memory_entities(project_id, entity_type, status);

CREATE TABLE memory_relations (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('PART_OF','DEPENDS_ON','BLOCKS','RESOLVES','PRODUCED','VERIFIED_BY','SUPERSEDES','RELATED_TO')),
  source_event_ids TEXT NOT NULL CHECK (json_valid(source_event_ids) AND json_array_length(source_event_ids) > 0),
  created_at TEXT NOT NULL,
  created_by_session_id TEXT NOT NULL,
  valid_from_sequence INTEGER NOT NULL,
  valid_to_sequence INTEGER,
  metadata TEXT NOT NULL CHECK (json_valid(metadata) AND json_type(metadata) = 'object'),
  PRIMARY KEY (project_id, id)
) STRICT;
