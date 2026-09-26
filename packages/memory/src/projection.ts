import { canonicalJson, memoryEventTypes } from '@graphit/core';
import type { EventProjection } from '@graphit/storage';
import type { MemoryEntity, MemoryRelation, MemoryState } from './domain.js';
import { replayMemory } from './replay.js';

export const memoryProjection: EventProjection = {
  name: 'memory',
  eventTypes: memoryEventTypes,
  rebuild(database, projectId, events): void {
    const state = replayMemory(events); // Validate every event before clearing any cache rows.
    database.prepare('DELETE FROM memory_relations WHERE project_id = ?').run(projectId);
    database.prepare('DELETE FROM memory_entities WHERE project_id = ?').run(projectId);
    const insertEntity = database.prepare(`INSERT INTO memory_entities
      (id, project_id, entity_type, content, status, created_at, source_event_ids, created_by_session_id,
       valid_from_sequence, valid_to_sequence, superseded_by, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of state.entities) insertEntity.run(item.id, item.project_id, item.entity_type, item.content,
      item.status, item.created_at, canonicalJson(item.source_event_ids), item.created_by_session_id,
      item.valid_from_sequence, item.valid_to_sequence, item.superseded_by, canonicalJson(item.metadata));
    const insertRelation = database.prepare(`INSERT INTO memory_relations
      (id, project_id, from_entity_id, to_entity_id, relation_type, source_event_ids, created_at,
       created_by_session_id, valid_from_sequence, valid_to_sequence, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of state.relations) insertRelation.run(item.id, item.project_id, item.from_entity_id, item.to_entity_id,
      item.relation_type, canonicalJson(item.source_event_ids), item.created_at, item.created_by_session_id,
      item.valid_from_sequence, item.valid_to_sequence, canonicalJson(item.metadata));
  },
  read(database, projectId): MemoryState {
    const decode = (row: Record<string, unknown>): Record<string, unknown> => ({ ...row,
      source_event_ids: JSON.parse(String(row.source_event_ids)) as unknown,
      metadata: JSON.parse(String(row.metadata)) as unknown });
    return {
      entities: database.prepare('SELECT * FROM memory_entities WHERE project_id = ? ORDER BY valid_from_sequence, id')
        .all(projectId).map((row) => decode(row) as unknown as MemoryEntity),
      relations: database.prepare('SELECT * FROM memory_relations WHERE project_id = ? ORDER BY valid_from_sequence, id')
        .all(projectId).map((row) => decode(row) as unknown as MemoryRelation),
    };
  },
};
