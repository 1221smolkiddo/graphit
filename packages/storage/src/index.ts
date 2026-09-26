import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  applyEvent, canonicalJson, contentHash, createEvent, reconstructState, verifyEvent,
  sessionMetadataSchema, type AppendEventInput, type Checkpoint, type EventData, type GraphEvent,
  type ProjectState, type Session, type SessionMetadata,
} from '@graphit/core';
import { migrate } from './migrations.js';
import { insertSourceBlob, readSourceBlob, type SourceBlob } from './blobs.js';
export { readSourceBlob, type SourceBlob } from './blobs.js';

export { migrate, migrations, type Migration } from './migrations.js';

export interface StoreOptions {
  clock?: () => string;
}

export interface EventProjection {
  name: string;
  eventTypes: readonly string[];
  rebuild(database: DatabaseSync, projectId: string, events: readonly GraphEvent[]): void;
  read(database: DatabaseSync, projectId: string): unknown;
  onAppend?(database: DatabaseSync, projectId: string, events: readonly GraphEvent[]): void;
}

export type ProjectAppendInput = EventData & { session_id?: string; created_at?: string };
export interface ProjectTransaction {
  readEvents(): GraphEvent[];
  getState(): ProjectState;
  append(input: ProjectAppendInput): GraphEvent;
  rebuildProjection(name: string): unknown;
  readProjection(name: string): unknown;
  putSourceBlob(bytes: Uint8Array): SourceBlob;
}

export interface ResumeResult {
  session: Session;
  checkpoint: Checkpoint;
  checkpoint_state: ProjectState;
  state: ProjectState;
}

export class EventStore {
  readonly #database: DatabaseSync;
  readonly #clock: () => string;
  readonly #projections = new Map<string, EventProjection>();

  constructor(path: string, options: StoreOptions = {}) {
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#database = new DatabaseSync(path);
    try {
      this.#database.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;');
      const mode = this.#database.prepare('PRAGMA journal_mode = WAL').get();
      if (mode?.journal_mode !== 'wal') throw new Error('Graphit requires a file-backed SQLite database with WAL');
      this.#database.exec('PRAGMA synchronous = FULL');
      migrate(this.#database);
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }

  readSourceBlob(hash: string): SourceBlob { return readSourceBlob(this.#database, hash); }

  registerProjection(projection: EventProjection): void {
    const existing = this.#projections.get(projection.name);
    if (existing && existing !== projection) throw new Error(`Projection already registered: ${projection.name}`);
    this.#projections.set(projection.name, projection);
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      if (result instanceof Promise) throw new Error('Transactions must be synchronous');
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  /** A project-scoped unit of work; sequence allocation and derived writes share its lock. */
  withProjectTransaction<T>(projectId: string, operation: (transaction: ProjectTransaction) => T): T {
    return this.#transaction(() => {
      let active = true;
      const ensureActive = (): void => { if (!active) throw new Error('Transaction is no longer active'); };
      const transaction: ProjectTransaction = {
        putSourceBlob: (bytes) => { ensureActive(); return insertSourceBlob(this.#database, bytes, this.#clock()); },
        readProjection: (name) => {
          ensureActive();
          const projection = this.#projections.get(name);
          if (!projection) throw new Error(`Projection is not registered: ${name}`);
          return projection.read(this.#database, projectId);
        },
        readEvents: () => { ensureActive(); return this.readEvents(projectId); },
        getState: () => { ensureActive(); return this.getState(projectId); },
        append: (input) => {
          ensureActive();
          const session_id = input.session_id ?? this.getState(projectId).active_session_id;
          if (!session_id) throw new Error('Project has no active session');
          return this.#append({ ...input, project_id: projectId, session_id });
        },
        rebuildProjection: (name) => {
          ensureActive();
          const projection = this.#projections.get(name);
          if (!projection) throw new Error(`Projection is not registered: ${name}`);
          const events = this.readEvents(projectId);
          if (!reconstructState(events).project) throw new Error('Project does not exist');
          projection.rebuild(this.#database, projectId, events);
          return projection.read(this.#database, projectId);
        },
      };
      try { return operation(transaction); }
      finally { active = false; }
    });
  }

  #decode(row: Record<string, unknown>): GraphEvent {
    if (typeof row.payload !== 'string') throw new Error('Invalid stored payload');
    const event = verifyEvent({ ...row, payload: JSON.parse(row.payload) as unknown });
    if (row.payload !== canonicalJson(event.payload)) throw new Error('Stored payload is not canonical');
    return event;
  }

  readEvents(projectId: string): GraphEvent[] {
    return this.#database.prepare('SELECT * FROM events WHERE project_id = ? ORDER BY sequence')
      .all(projectId).map((row) => this.#decode(row));
  }

  /** Reads use source events, never potentially stale projection rows. */
  getState(projectId: string): ProjectState {
    const state = reconstructState(this.readEvents(projectId));
    if (!state.project) throw new Error('Project does not exist');
    return state;
  }

  listProjects(): ProjectState[] {
    // A single SELECT provides a consistent snapshot across all projects.
    const rows = this.#database.prepare('SELECT * FROM events ORDER BY project_id, sequence').all();
    const groups = new Map<string, GraphEvent[]>();
    for (const row of rows) {
      const event = this.#decode(row);
      const group = groups.get(event.project_id) ?? [];
      group.push(event);
      groups.set(event.project_id, group);
    }
    return [...groups.values()].map(reconstructState);
  }

  findProject(rootPath: string): ProjectState | undefined {
    const absolutePath = resolve(rootPath);
    return this.listProjects().find((state) => state.project?.root_path === absolutePath);
  }

  #project(state: ProjectState): void {
    const project = state.project;
    if (!project) throw new Error('Cannot project an empty state');
    this.#database.prepare(`INSERT INTO projects (id, name, root_path, created_at, active_session_id, last_sequence)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name,
      root_path = excluded.root_path, created_at = excluded.created_at,
      active_session_id = excluded.active_session_id, last_sequence = excluded.last_sequence`)
      .run(project.id, project.name, project.root_path, project.created_at, state.active_session_id, state.last_sequence);
    this.#database.prepare('DELETE FROM checkpoints WHERE project_id = ?').run(project.id);
    this.#database.prepare('DELETE FROM sessions WHERE project_id = ?').run(project.id);
    const sessionInsert = this.#database.prepare(`INSERT INTO sessions
      (id, project_id, created_at, resumed_from_checkpoint_id, provider, agent_name, model_name, external_session_id, client_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const session of state.sessions) {
      sessionInsert.run(session.id, session.project_id, session.created_at, session.resumed_from_checkpoint_id,
        session.provider ?? null, session.agent_name ?? null, session.model_name ?? null,
        session.external_session_id ?? null, session.client_name ?? null);
    }
    const checkpointInsert = this.#database.prepare(`INSERT INTO checkpoints
      (id, project_id, session_id, name, through_sequence, state_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const checkpoint of state.checkpoints) {
      checkpointInsert.run(checkpoint.id, checkpoint.project_id, checkpoint.session_id, checkpoint.name,
        checkpoint.through_sequence, checkpoint.state_hash, checkpoint.created_at);
    }
  }

  #append(input: AppendEventInput): GraphEvent {
    const history = this.readEvents(input.project_id);
    const previous = reconstructState(history);
    const event = createEvent({ ...input, sequence: previous.last_sequence + 1, created_at: input.created_at ?? this.#clock() });
    for (const item of [...history, event]) {
      if ((item.event_type.startsWith('memory.') || item.event_type.startsWith('code.')) && ![...this.#projections.values()].some((projection) => projection.eventTypes.includes(item.event_type))) {
        throw new Error('Extension writes require the corresponding projection handler');
      }
    }
    const state = applyEvent(previous, event);
    this.#database.prepare(`INSERT INTO events
      (id, project_id, session_id, sequence, event_type, payload, created_at, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(event.id, event.project_id, event.session_id, event.sequence, event.event_type,
        canonicalJson(event.payload), event.created_at, event.content_hash);
    this.#project(state);
    for (const projection of this.#projections.values()) {
      (projection.onAppend ?? projection.rebuild)(this.#database, input.project_id, [...history, event]);
    }
    return event;
  }

  appendEvent(input: AppendEventInput): GraphEvent {
    return this.#transaction(() => this.#append(input));
  }

  startSession(projectId: string, metadata: SessionMetadata = {}): Session {
    return this.withProjectTransaction(projectId, (transaction) => {
      // Preserve absent metadata keys so existing P0 checkpoint hashes remain valid.
      const payload = sessionMetadataSchema.parse(metadata);
      const session_id = randomUUID();
      transaction.append({ event_type: 'session.started', session_id, payload });
      return transaction.getState().sessions.find((session) => session.id === session_id)!;
    });
  }

  initializeProject(rootPath: string, name: string): ProjectState {
    return this.#transaction(() => {
      const root_path = resolve(rootPath);
      if (this.findProject(root_path)) throw new Error('Project is already initialized');
      const project_id = randomUUID();
      const session_id = randomUUID();
      this.#append({ project_id, session_id, event_type: 'project.created', payload: { name, root_path } });
      this.#append({ project_id, session_id, event_type: 'session.started', payload: {} });
      return this.getState(project_id);
    });
  }

  checkpoint(projectId: string, name = 'checkpoint'): Checkpoint {
    return this.#transaction(() => {
      const state = this.getState(projectId);
      if (!state.active_session_id) throw new Error('Project has no active session');
      const event = this.#append({
        project_id: projectId,
        session_id: state.active_session_id,
        event_type: 'checkpoint.created',
        payload: { name, through_sequence: state.last_sequence, state_hash: contentHash(state) },
      });
      const checkpoint = this.getState(projectId).checkpoints.find((item) => item.id === event.id);
      if (!checkpoint) throw new Error('Checkpoint reconstruction failed');
      return checkpoint;
    });
  }

  resume(projectId: string, checkpointId?: string): ResumeResult {
    return this.#transaction(() => {
      const events = this.readEvents(projectId);
      const previous = reconstructState(events);
      if (!previous.project) throw new Error('Project does not exist');
      const checkpoint = checkpointId === undefined
        ? previous.checkpoints.at(-1)
        : previous.checkpoints.find((item) => item.id === checkpointId);
      if (!checkpoint) throw new Error('Checkpoint not found; run graphit checkpoint first');
      const checkpoint_state = reconstructState(events.filter((event) => event.sequence <= checkpoint.through_sequence));
      if (contentHash(checkpoint_state) !== checkpoint.state_hash) throw new Error('Checkpoint integrity check failed');
      const session_id = randomUUID();
      this.#append({ project_id: projectId, session_id, event_type: 'session.resumed', payload: { checkpoint_id: checkpoint.id } });
      const state = this.getState(projectId);
      const session = state.sessions.find((item) => item.id === session_id);
      if (!session) throw new Error('Session reconstruction failed');
      return { session, checkpoint, checkpoint_state, state };
    });
  }

  /** Repair disposable projections in one transaction without touching events. */
  rebuildProjections(): void {
    this.#transaction(() => {
      const states = this.listProjects();
      this.#database.exec('DELETE FROM checkpoints; DELETE FROM sessions; DELETE FROM projects;');
      for (const state of states) {
        this.#project(state);
        for (const projection of this.#projections.values()) {
          projection.rebuild(this.#database, state.project!.id, this.readEvents(state.project!.id));
        }
      }
    });
  }
}
