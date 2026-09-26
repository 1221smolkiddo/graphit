import { canonicalJson, reconstructState } from '@graphit/core';
import { EventStore, type ProjectTransaction } from '@graphit/storage';
import { z } from 'zod';
import {
  entityTypeSchema, memoryEntityId, memoryRelationId, promotionSchema, provenanceSchema,
  relationTypeSchema, resolutionStatus, sourceIds, statusSchema,
  type EntityType, type MemoryEntity, type MemoryRelation, type MemoryState, type MemoryStatus,
  type Metadata, type PromotionInput, type RelationType,
} from './domain.js';
import { buildHandoff, type HandoffPacket } from './handoff.js';
import { memoryProjection } from './projection.js';
import { replayMemory } from './replay.js';

export * from './domain.js';
export * from './handoff.js';
export * from './replay.js';

export type SupersedeInput = { replacementId: string; sourceEventIds?: string[] }
  | { content: string; sourceEventIds: string[]; metadata?: Metadata };
export interface LinkInput {
  fromEntityId: string;
  toEntityId: string;
  relationType: RelationType;
  sourceEventIds: string[];
  metadata?: Metadata;
}

/** A service over EventStore. It has no separate canonical storage or provider adapters. */
export class MemoryService {
  constructor(readonly store: EventStore) { store.registerProjection(memoryProjection); }

  #state(transaction: ProjectTransaction): MemoryState { return replayMemory(transaction.readEvents()); }

  #entity(transaction: ProjectTransaction, id: string): MemoryEntity {
    const entity = this.#state(transaction).entities.find((item) => item.id === id);
    if (!entity) throw new Error('Memory entity does not exist in this project');
    return entity;
  }

  #promote(projectId: string, transaction: ProjectTransaction, input: PromotionInput): MemoryEntity {
    canonicalJson(input);
    const parsed = promotionSchema.parse(input);
    const id = memoryEntityId(projectId, parsed);
    const existing = this.#state(transaction).entities.find((entity) => entity.id === id);
    if (existing) return existing; // Explicit promotion is deterministic and retry-idempotent.
    transaction.append({ event_type: 'memory.entity.created', payload: { entity_id: id, entity_type: parsed.entityType,
      content: parsed.content, source_event_ids: sourceIds(parsed.sourceEventIds), metadata: parsed.metadata ?? {} } });
    return this.#entity(transaction, id);
  }

  promoteMemory(projectId: string, input: PromotionInput): MemoryEntity {
    return this.store.withProjectTransaction(projectId, (transaction) => this.#promote(projectId, transaction, input));
  }

  rebuildMemoryProjection(projectId: string): MemoryState {
    return this.store.withProjectTransaction(projectId, (transaction) => transaction.rebuildProjection('memory') as MemoryState);
  }

  getMemoryState(projectId: string, throughSequence?: number): MemoryState {
    const events = this.store.readEvents(projectId);
    if (!reconstructState(events).project) throw new Error('Project does not exist');
    return replayMemory(events, throughSequence);
  }

  listMemory(projectId: string, filter: { type?: EntityType; status?: MemoryStatus } = {}): MemoryEntity[] {
    const parsed = z.object({ type: entityTypeSchema.optional(), status: statusSchema.optional() }).strict().parse(filter);
    return this.rebuildMemoryProjection(projectId).entities.filter((entity) =>
      (parsed.type === undefined || entity.entity_type === parsed.type) && (parsed.status === undefined || entity.status === parsed.status));
  }

  changeStatus(projectId: string, id: string, status: Exclude<MemoryStatus, 'superseded'>, sources?: string[]): MemoryEntity {
    return this.store.withProjectTransaction(projectId, (transaction) => {
      const entity = this.#entity(transaction, id);
      transaction.append({ event_type: 'memory.entity.status_changed', payload: { entity_id: id, status,
        source_event_ids: sourceIds(sources ?? entity.source_event_ids) } });
      return this.#entity(transaction, id);
    });
  }

  resolveMemory(projectId: string, id: string, sources?: string[]): MemoryEntity {
    return this.store.withProjectTransaction(projectId, (transaction) => {
      const entity = this.#entity(transaction, id);
      transaction.append({ event_type: 'memory.entity.status_changed', payload: { entity_id: id,
        status: resolutionStatus(entity.entity_type), source_event_ids: sourceIds(sources ?? entity.source_event_ids) } });
      return this.#entity(transaction, id);
    });
  }

  supersedeMemory(projectId: string, id: string, input: SupersedeInput): { previous: MemoryEntity; replacement: MemoryEntity } {
    canonicalJson(input);
    return this.store.withProjectTransaction(projectId, (transaction) => {
      const previous = this.#entity(transaction, id);
      const replacement = 'replacementId' in input ? this.#entity(transaction, input.replacementId)
        : this.#promote(projectId, transaction, { entityType: previous.entity_type, content: input.content,
          sourceEventIds: input.sourceEventIds, metadata: input.metadata ?? previous.metadata });
      const sources = provenanceSchema.parse(input.sourceEventIds ?? replacement.source_event_ids);
      transaction.append({ event_type: 'memory.entity.superseded', payload: { entity_id: id,
        replacement_id: replacement.id, source_event_ids: sourceIds(sources) } });
      return { previous: this.#entity(transaction, id), replacement: this.#entity(transaction, replacement.id) };
    });
  }

  linkMemory(projectId: string, input: LinkInput): MemoryRelation {
    canonicalJson(input);
    return this.store.withProjectTransaction(projectId, (transaction) => {
      const relationType = relationTypeSchema.parse(input.relationType);
      const sources = provenanceSchema.parse(input.sourceEventIds);
      const metadata = input.metadata ?? {};
      const id = memoryRelationId(projectId, input.fromEntityId, input.toEntityId, relationType, sources, metadata);
      const existing = this.#state(transaction).relations.find((relation) => relation.id === id);
      if (existing) return existing;
      transaction.append({ event_type: 'memory.entity.linked', payload: { relation_id: id,
        from_entity_id: input.fromEntityId, to_entity_id: input.toEntityId, relation_type: relationType,
        source_event_ids: sourceIds(sources), metadata } });
      return this.#state(transaction).relations.find((relation) => relation.id === id)!;
    });
  }

  generateHandoff(projectId: string): HandoffPacket {
    return this.store.withProjectTransaction(projectId, (transaction) => {
      // Restore missing/stale rows, then consume validated projections in the same snapshot.
      const memory = transaction.rebuildProjection('memory') as MemoryState;
      const events = transaction.readEvents();
      return buildHandoff(reconstructState(events), memory, events);
    });
  }
}
