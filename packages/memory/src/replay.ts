import { applyEvent, contentHash, emptyState, verifyEvent, type GraphEvent } from '@graphit/core';
import {
  memoryEntityId, memoryPayloadSchemas, memoryRelationId, sourceIds, validateStatusChange,
  type MemoryEntity, type MemoryRelation, type MemoryState,
} from './domain.js';

/** Replay is pure; historical views use an inclusive project event sequence. */
export function replayMemory(events: readonly GraphEvent[], throughSequence = Number.MAX_SAFE_INTEGER): MemoryState {
  if (!Number.isSafeInteger(throughSequence) || throughSequence < 0) throw new Error('Invalid replay sequence');
  const entities = new Map<string, MemoryEntity>();
  const relations = new Map<string, MemoryRelation>();
  const sources = new Map<string, GraphEvent>();
  let projectState = emptyState();

  function entity(id: string): MemoryEntity {
    const value = entities.get(id);
    if (!value) throw new Error('Memory entity does not exist in this project');
    return value;
  }
  function provenance(ids: string[], event: GraphEvent): void {
    for (const id of ids) {
      const source = sources.get(id);
      if (!source || source.project_id !== event.project_id || source.sequence >= event.sequence) {
        throw new Error('Provenance must reference earlier source events in the same project');
      }
    }
  }
  function supersede(oldId: string, replacementId: string, ids: string[], event: GraphEvent): void {
    const previous = entity(oldId);
    const replacement = entity(replacementId);
    if (oldId === replacementId || previous.valid_to_sequence !== null || replacement.status !== 'active'
      || previous.entity_type !== replacement.entity_type) throw new Error('Invalid memory supersession');
    entities.set(oldId, { ...previous, status: 'superseded', valid_to_sequence: event.sequence,
      superseded_by: replacementId, source_event_ids: sourceIds([...previous.source_event_ids, ...ids, event.id]) });
    entities.set(replacementId, { ...replacement,
      source_event_ids: sourceIds([...replacement.source_event_ids, ...ids, event.id]) });
  }

  for (const input of events) {
    if (input.sequence > throughSequence) break;
    const event = verifyEvent(input);
    projectState = applyEvent(projectState, event);
    switch (event.event_type) {
      case 'memory.entity.created': {
        const payload = memoryPayloadSchemas[event.event_type].parse(event.payload);
        provenance(payload.source_event_ids, event);
        const expected = memoryEntityId(event.project_id, { sourceEventIds: payload.source_event_ids,
          entityType: payload.entity_type, content: payload.content, metadata: payload.metadata });
        if (payload.entity_id !== expected) throw new Error('Invalid deterministic memory ID');
        if (entities.has(expected)) throw new Error('Memory entity already exists');
        entities.set(expected, { id: expected, project_id: event.project_id, entity_type: payload.entity_type,
          content: payload.content, status: 'active', created_at: event.created_at,
          source_event_ids: sourceIds([...payload.source_event_ids, event.id]), created_by_session_id: event.session_id,
          valid_from_sequence: event.sequence, valid_to_sequence: null, superseded_by: null, metadata: payload.metadata });
        break;
      }
      case 'memory.entity.status_changed': {
        const payload = memoryPayloadSchemas[event.event_type].parse(event.payload);
        provenance(payload.source_event_ids, event);
        const previous = entity(payload.entity_id);
        validateStatusChange(previous, payload.status);
        entities.set(previous.id, { ...previous, status: payload.status,
          valid_to_sequence: payload.status === 'cancelled' ? event.sequence : null,
          source_event_ids: sourceIds([...previous.source_event_ids, ...payload.source_event_ids, event.id]) });
        break;
      }
      case 'memory.entity.superseded': {
        const payload = memoryPayloadSchemas[event.event_type].parse(event.payload);
        provenance(payload.source_event_ids, event);
        supersede(payload.entity_id, payload.replacement_id, payload.source_event_ids, event);
        const id = contentHash({ domain: 'graphit:supersedes:v1', event_id: event.id });
        relations.set(id, { id, project_id: event.project_id, from_entity_id: payload.replacement_id,
          to_entity_id: payload.entity_id, relation_type: 'SUPERSEDES',
          source_event_ids: sourceIds([...payload.source_event_ids, event.id]), created_at: event.created_at,
          created_by_session_id: event.session_id, valid_from_sequence: event.sequence, valid_to_sequence: null, metadata: {} });
        break;
      }
      case 'memory.entity.linked': {
        const payload = memoryPayloadSchemas[event.event_type].parse(event.payload);
        provenance(payload.source_event_ids, event);
        entity(payload.from_entity_id);
        entity(payload.to_entity_id);
        if (payload.from_entity_id === payload.to_entity_id) throw new Error('Self relationships are not allowed');
        const expected = memoryRelationId(event.project_id, payload.from_entity_id, payload.to_entity_id,
          payload.relation_type, payload.source_event_ids, payload.metadata);
        if (expected !== payload.relation_id || relations.has(expected)) throw new Error('Invalid or duplicate relationship ID');
        if (payload.relation_type === 'SUPERSEDES') supersede(payload.to_entity_id, payload.from_entity_id, payload.source_event_ids, event);
        relations.set(expected, { id: expected, project_id: event.project_id, from_entity_id: payload.from_entity_id,
          to_entity_id: payload.to_entity_id, relation_type: payload.relation_type,
          source_event_ids: sourceIds([...payload.source_event_ids, event.id]), created_at: event.created_at,
          created_by_session_id: event.session_id, valid_from_sequence: event.sequence, valid_to_sequence: null, metadata: payload.metadata });
        break;
      }
    }
    sources.set(event.id, event);
  }
  return { entities: [...entities.values()], relations: [...relations.values()] };
}
