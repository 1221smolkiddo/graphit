-- Search is disposable. Never index/copy entire canonical source blobs.
CREATE VIRTUAL TABLE retrieval_memory_fts USING fts5(
  project_id UNINDEXED, id UNINDEXED, content, entity_type, status, tokenize='unicode61'
);
CREATE VIRTUAL TABLE retrieval_code_fts USING fts5(
  project_id UNINDEXED, id UNINDEXED, name, qualified_name, path, signature, tokenize='unicode61'
);
CREATE TABLE retrieval_projection_state (
  project_id TEXT PRIMARY KEY NOT NULL,
  document_hash TEXT NOT NULL
) STRICT;
