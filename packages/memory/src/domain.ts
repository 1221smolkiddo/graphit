import { z } from 'zod';
import {
  contentHash, hashSchema, metadataSchema, registerMemoryEventSchema,
  type JsonValue, type MemoryEventType,
} from '@graphit/core';

export const entityTypes = ['goal', 'task', 'decision', 'constraint', 'blocker', 'question', 'action', 'result', 'artifact'] as const;
export const statuses = ['active', 'in_progress', 'completed', 'resolved', 'cancelled', 'superseded'] as const;
export const relationTypes = ['PART_OF', 'DEPENDS_ON', 'BLOCKS', 'RESOLVES', 'PRODUCED', 'VERIFIED_BY', 'SUPERSEDES', 'RELATED_TO'] as const;
export const entityTypeSchema = z.enum(entityTypes);
export const statusSchema = z.enum(statuses);
export const relationTypeSchema = z.enum(relationTypes);
export type EntityType = z.infer<typeof entityTypeSchema>;
export type MemoryStatus = z.infer<typeof statusSchema>;
export type RelationType = z.infer<typeof relationTypeSchema>;
export type Metadata = Record<string, JsonValue>;

export const provenanceSchema = z.array(hashSchema).min(1).refine((ids) => new Set(ids).size === ids.length, 'Duplicate provenance reference');
const contentSchema = z.string().min(1).refine((content) => content.trim().length > 0, 'Memory content cannot be blank');
export const memoryPayloadSchemas = {
  'memory.entity.created': z.object({ entity_id: hashSchema, entity_type: entityTypeSchema,
    content: contentSchema, source_event_ids: provenanceSchema, metadata: metadataSchema }).strict(),
  'memory.entity.status_changed': z.object({ entity_id: hashSchema,
    status: z.enum(['active', 'in_progress', 'completed', 'resolved', 'cancelled']), source_event_ids: provenanceSchema }).strict(),
  'memory.entity.superseded': z.object({ entity_id: hashSchema, replacement_id: hashSchema,
    source_event_ids: provenanceSchema }).strict(),
  'memory.entity.linked': z.object({ relation_id: hashSchema, from_entity_id: hashSchema, to_entity_id: hashSchema,
    relation_type: relationTypeSchema, source_event_ids: provenanceSchema, metadata: metadataSchema }).strict(),
} satisfies Record<MemoryEventType, z.ZodType<Metadata>>;

export type MemoryEventData = {
  [K in MemoryEventType]: { event_type: K; payload: z.infer<(typeof memoryPayloadSchemas)[K]> }
}[MemoryEventType];

for (const type of Object.keys(memoryPayloadSchemas) as MemoryEventType[]) registerMemoryEventSchema(type, memoryPayloadSchemas[type]);

export interface MemoryEntity {
  id: string;
  project_id: string;
  entity_type: EntityType;
  content: string;
  status: MemoryStatus;
  created_at: string;
  source_event_ids: string[];
  created_by_session_id: string;
  valid_from_sequence: number;
  valid_to_sequence: number | null;
  superseded_by: string | null;
  metadata: Metadata;
}

export interface MemoryRelation {
  id: string;
  project_id: string;
  from_entity_id: string;
  to_entity_id: string;
  relation_type: RelationType;
  source_event_ids: string[];
  created_at: string;
  created_by_session_id: string;
  valid_from_sequence: number;
  valid_to_sequence: number | null;
  metadata: Metadata;
}

export interface MemoryState {
  entities: MemoryEntity[];
  relations: MemoryRelation[];
}

export const promotionSchema = z.object({ sourceEventIds: provenanceSchema, entityType: entityTypeSchema,
  content: contentSchema, metadata: metadataSchema.optional() }).strict();
export type PromotionInput = z.infer<typeof promotionSchema>;

export function sourceIds(ids: readonly string[]): string[] { return [...new Set(ids)].sort(); }

export function memoryEntityId(projectId: string, input: PromotionInput): string {
  return contentHash({ domain: 'graphit:memory:v1', project_id: projectId, entity_type: input.entityType,
    content: input.content, source_event_ids: sourceIds(input.sourceEventIds), metadata: input.metadata ?? {} });
}

export function memoryRelationId(projectId: string, from: string, to: string, type: RelationType, sources: string[], metadata: Metadata): string {
  return contentHash({ domain: 'graphit:relation:v1', project_id: projectId, from_entity_id: from,
    to_entity_id: to, relation_type: type, source_event_ids: sourceIds(sources), metadata });
}

export function resolutionStatus(type: EntityType): 'completed' | 'resolved' {
  if (type === 'goal' || type === 'task' || type === 'action') return 'completed';
  if (type === 'blocker' || type === 'question') return 'resolved';
  throw new Error(`Cannot resolve ${type}; use supersede or an explicit cancellation`);
}

export function validateStatusChange(entity: MemoryEntity, status: MemoryStatus): void {
  if (!['active', 'in_progress'].includes(entity.status)) throw new Error('Terminal memory cannot change status');
  if (status === entity.status || status === 'active' || status === 'superseded') throw new Error('Invalid memory status transition');
  if (status === 'cancelled') return;
  const allowed = ['goal', 'task', 'action'].includes(entity.entity_type)
    ? ['in_progress', 'completed'] : ['blocker', 'question'].includes(entity.entity_type) ? ['resolved'] : [];
  if (!allowed.includes(status)) throw new Error(`Invalid ${entity.entity_type} status: ${status}`);
}
