import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sessionMetadataSchema, sourcePayloadSchemas, type SessionMetadata, type SourceEventData } from './source-schemas.js';
export * from './source-schemas.js';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Stable JSON: sorted object keys, preserved array order, no lossy JS values. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown): string {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || item === null) throw new Error('Value is not JSON');
    if (ancestors.has(item)) throw new Error('Cyclic JSON value');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) return `[${Array.from(item, (entry: unknown) => encode(entry)).join(',')}]`;
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
        throw new Error('JSON objects must be plain objects');
      }
      if (Object.getOwnPropertySymbols(item).length !== 0) throw new Error('Symbol keys are not JSON');
      const record = item as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${encode(record[key])}`).join(',')}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value);
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function contentHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

export const timestampSchema = z.string().refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}, 'Expected a canonical UTC ISO timestamp');

export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = z.string().uuid();
const sequenceSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const envelopeSchema = z.object({
  project_id: idSchema,
  session_id: idSchema,
  sequence: sequenceSchema,
  created_at: timestampSchema,
}).strict();

const unsignedEventSchema = z.discriminatedUnion('event_type', [
  envelopeSchema.extend({
    event_type: z.literal('project.created'),
    payload: z.object({ name: z.string().trim().min(1).max(200), root_path: z.string().min(1) }).strict(),
  }).strict(),
  envelopeSchema.extend({
    event_type: z.literal('session.started'),
    payload: sessionMetadataSchema,
  }).strict(),
  envelopeSchema.extend({
    event_type: z.literal('checkpoint.created'),
    payload: z.object({ name: z.string().trim().min(1).max(200), through_sequence: sequenceSchema, state_hash: hashSchema }).strict(),
  }).strict(),
  envelopeSchema.extend({
    event_type: z.literal('session.resumed'),
    payload: sessionMetadataSchema.extend({ checkpoint_id: hashSchema }).strict(),
  }).strict(),
]);

export const memoryEventTypes = ['memory.entity.created', 'memory.entity.status_changed',
  'memory.entity.superseded', 'memory.entity.linked'] as const;
export type MemoryEventType = typeof memoryEventTypes[number];
export const codeEventTypes = ['code.index.started', 'code.file.observed', 'code.file.deleted', 'code.index.completed', 'code.index.failed'] as const;
export type CodeEventType = typeof codeEventTypes[number];
export type ExtensionEventData = { event_type: MemoryEventType | CodeEventType; payload: { [key: string]: JsonValue | undefined } };
type Envelope = z.infer<typeof envelopeSchema>;
export type UnsignedEvent = z.infer<typeof unsignedEventSchema> | (Envelope & (SourceEventData | ExtensionEventData));
export type GraphEvent = UnsignedEvent & { id: string; content_hash: string };
export type EventType = GraphEvent['event_type'];
type BaseUnsignedEvent = z.infer<typeof unsignedEventSchema>;
export type EventData = {
  [K in BaseUnsignedEvent['event_type']]: Pick<Extract<BaseUnsignedEvent, { event_type: K }>, 'event_type' | 'payload'>
}[BaseUnsignedEvent['event_type']] | SourceEventData | ExtensionEventData;
export type AppendEventInput = EventData & { project_id: string; session_id: string; created_at?: string };

const extensionSchemas = new Map<string, z.ZodType<{ [key: string]: JsonValue | undefined }>>();
/** Memory owns its schemas; core knows only the immutable envelope. */
export function registerMemoryEventSchema(type: MemoryEventType, schema: z.ZodType<{ [key: string]: JsonValue }>): void {
  registerExtensionEventSchema(type, schema);
}

export function registerExtensionEventSchema(type: MemoryEventType | CodeEventType, schema: z.ZodType<{ [key: string]: JsonValue | undefined }>): void {
  const existing = extensionSchemas.get(type);
  if (existing && existing !== schema) throw new Error(`Event schema already registered: ${type}`);
  extensionSchemas.set(type, schema);
}

function parseUnsigned(input: unknown): UnsignedEvent {
  const header = envelopeSchema.extend({ event_type: z.string(), payload: z.unknown() }).strict().parse(input);
  const sourceSchema = Object.prototype.hasOwnProperty.call(sourcePayloadSchemas, header.event_type)
    ? sourcePayloadSchemas[header.event_type as keyof typeof sourcePayloadSchemas] : undefined;
  if (sourceSchema) return { ...header, payload: sourceSchema.parse(header.payload) } as Envelope & SourceEventData;
  if (header.event_type.startsWith('memory.') || header.event_type.startsWith('code.')) {
    const schema = extensionSchemas.get(header.event_type);
    if (!schema) throw new Error(`Extension event schema is not registered: ${header.event_type}`);
    return { ...header, event_type: header.event_type as MemoryEventType | CodeEventType, payload: schema.parse(header.payload) };
  }
  return unsignedEventSchema.parse(input);
}

/** Identity covers the entire unsigned envelope, including timestamp and sequence. */
export function createEvent(input: unknown): GraphEvent {
  canonicalJson(input);
  const parsed = parseUnsigned(input);
  const content_hash = contentHash(parsed);
  const id = sha256(`graphit:event:v1:${content_hash}`);
  return { ...parsed, id, content_hash };
}

const storedEventSchema = envelopeSchema.extend({
  id: hashSchema,
  event_type: z.string(),
  payload: z.unknown(),
  content_hash: hashSchema,
}).strict();

export function verifyEvent(input: unknown): GraphEvent {
  canonicalJson(input);
  const { id, content_hash, ...unsigned } = storedEventSchema.parse(input);
  const event = createEvent(unsigned);
  if (event.id !== id || event.content_hash !== content_hash) throw new Error('Event integrity check failed');
  return event;
}

export interface Project {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
}

export interface Session extends SessionMetadata {
  id: string;
  project_id: string;
  created_at: string;
  resumed_from_checkpoint_id: string | null;
}

export interface Checkpoint {
  id: string;
  project_id: string;
  session_id: string;
  name: string;
  through_sequence: number;
  state_hash: string;
  created_at: string;
}

export interface ProjectState {
  project: Project | null;
  sessions: Session[];
  checkpoints: Checkpoint[];
  active_session_id: string | null;
  last_sequence: number;
}

export function emptyState(): ProjectState {
  return { project: null, sessions: [], checkpoints: [], active_session_id: null, last_sequence: 0 };
}

/** Pure reducer: validate order, identity, relationships and checkpoint claims. */
export function applyEvent(previous: ProjectState, input: unknown): ProjectState {
  const event = verifyEvent(input);
  if (event.sequence !== previous.last_sequence + 1) throw new Error('Non-contiguous project sequence');
  if (previous.project && previous.project.id !== event.project_id) throw new Error('Cross-project event');
  if (!previous.project && event.event_type !== 'project.created') throw new Error('Project must be created first');
  const state = structuredClone(previous);
  switch (event.event_type) {
    case 'project.created': {
      if (state.project) throw new Error('Project already exists');
      state.project = { id: event.project_id, ...event.payload, created_at: event.created_at };
      break;
    }
    case 'session.started':
    case 'session.resumed': {
      if (state.sessions.some((session) => session.id === event.session_id)) throw new Error('Session already exists');
      const checkpointId = event.event_type === 'session.resumed' ? event.payload.checkpoint_id : null;
      if (checkpointId && !state.checkpoints.some((checkpoint) => checkpoint.id === checkpointId)) {
        throw new Error('Checkpoint does not exist in this project');
      }
      const metadata = { ...event.payload };
      if ('checkpoint_id' in metadata) delete (metadata as Partial<typeof metadata>).checkpoint_id;
      state.sessions.push({ id: event.session_id, project_id: event.project_id, created_at: event.created_at,
        resumed_from_checkpoint_id: checkpointId, ...sessionMetadataSchema.parse(metadata) });
      state.active_session_id = event.session_id;
      break;
    }
    case 'checkpoint.created': {
      if (state.active_session_id !== event.session_id) throw new Error('Checkpoint requires the active session');
      if (event.payload.through_sequence !== previous.last_sequence || event.payload.state_hash !== contentHash(previous)) {
        throw new Error('Checkpoint does not match the preceding event state');
      }
      state.checkpoints.push({ id: event.id, project_id: event.project_id, session_id: event.session_id, ...event.payload, created_at: event.created_at });
      break;
    }
    default:
      if (state.active_session_id !== event.session_id) throw new Error('Source and memory events require the active session');
  }
  state.last_sequence = event.sequence;
  return state;
}

export function reconstructState(events: readonly unknown[]): ProjectState {
  return events.reduce<ProjectState>(applyEvent, emptyState());
}
export { nodeSupported, requireSupportedNode, supportedNodeRange } from './runtime.js';
