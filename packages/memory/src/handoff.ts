import type { GraphEvent, Project, ProjectState, Session } from '@graphit/core';
import type { MemoryEntity, MemoryRelation, MemoryState } from './domain.js';

export interface HandoffPacket {
  schema_version: '1';
  project: Project;
  generated_at: string;
  current_session: Session | null;
  goals: MemoryEntity[];
  active_tasks: MemoryEntity[];
  completed_tasks: MemoryEntity[];
  decisions: MemoryEntity[];
  constraints: MemoryEntity[];
  blockers: MemoryEntity[];
  open_questions: MemoryEntity[];
  actions: MemoryEntity[];
  recent_results: MemoryEntity[];
  artifacts: MemoryEntity[];
  history: MemoryEntity[];
  relations: MemoryRelation[];
  evidence: GraphEvent[];
  source_range: { first_sequence: number; last_sequence: number };
}

/** No summaries, provider formatting, ranking or wall-clock nondeterminism. */
export function buildHandoff(project: ProjectState, memory: MemoryState, events: readonly GraphEvent[]): HandoffPacket {
  if (!project.project || !events.length) throw new Error('Cannot hand off an empty project');
  const current = memory.entities.filter((entity) => entity.valid_to_sequence === null);
  const byType = (type: MemoryEntity['entity_type']): MemoryEntity[] => current.filter((entity) => entity.entity_type === type);
  const groups = {
    goals: byType('goal'),
    active_tasks: byType('task').filter((entity) => ['active', 'in_progress'].includes(entity.status)),
    completed_tasks: byType('task').filter((entity) => entity.status === 'completed'),
    decisions: byType('decision').filter((entity) => entity.status === 'active'),
    constraints: byType('constraint').filter((entity) => entity.status === 'active'),
    blockers: byType('blocker').filter((entity) => entity.status === 'active'),
    open_questions: byType('question').filter((entity) => entity.status === 'active'),
    actions: byType('action'),
    recent_results: byType('result').slice(-20).reverse(),
    artifacts: byType('artifact'),
  };
  const included = new Set(Object.values(groups).flat().map((entity) => entity.id));
  const history = memory.entities.filter((entity) => !included.has(entity.id));
  const byId = new Map(events.map((event) => [event.id, event]));
  const evidenceIds = new Set<string>();
  const pending = [...memory.entities, ...memory.relations].flatMap((item) => item.source_event_ids);
  // Project and session identities are evidence-backed too.
  for (const event of events) {
    if (event.event_type === 'project.created' ||
      ((event.event_type === 'session.started' || event.event_type === 'session.resumed') && event.session_id === project.active_session_id)) {
      pending.push(event.id);
    }
  }
  while (pending.length) {
    const id = pending.pop()!;
    if (evidenceIds.has(id)) continue;
    const event = byId.get(id);
    if (!event) throw new Error('Handoff provenance is missing from the event stream');
    evidenceIds.add(id);
    if (event.event_type.startsWith('memory.')) {
      const references = event.payload as { source_event_ids: string[] };
      pending.push(...references.source_event_ids);
    }
    const session = events.find((item) => item.session_id === event.session_id &&
      (item.event_type === 'session.started' || item.event_type === 'session.resumed'));
    if (session) pending.push(session.id);
  }
  return {
    schema_version: '1', project: project.project,
    // Logical generation time of this exact event prefix makes regeneration byte-stable.
    generated_at: events.at(-1)!.created_at,
    current_session: project.sessions.find((session) => session.id === project.active_session_id) ?? null,
    ...groups, history, relations: memory.relations,
    evidence: events.filter((event) => evidenceIds.has(event.id)),
    source_range: { first_sequence: events[0]!.sequence, last_sequence: project.last_sequence },
  };
}
