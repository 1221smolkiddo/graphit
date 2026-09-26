import { reconstructState, type GraphEvent } from '@graphit/core';
import { codePayloadSchemas, type FileObservation, type IndexRun } from './domain.js';

export interface CodeHistory { active: Map<string, FileObservation>; runs: IndexRun[]; last_event_sequence: number }
export function replayCodeHistory(events: readonly GraphEvent[]): CodeHistory {
  const project = reconstructState(events).project;
  const active = new Map<string, FileObservation>(); const runs = new Map<string, IndexRun>();
  const pending = new Map<string, Map<string, FileObservation | null>>();
  let last_event_sequence = 0;
  for (const event of events) {
    if (!event.event_type.startsWith('code.')) continue;
    last_event_sequence = event.sequence;
    if (event.event_type === 'code.index.started') {
      const payload = codePayloadSchemas[event.event_type].parse(event.payload);
      if (!project || payload.root_path !== project.root_path || runs.has(payload.index_run_id) || [...runs.values()].some((run) => run.status === 'running')) throw new Error('Invalid or overlapping index run');
      runs.set(payload.index_run_id, { ...payload, project_id: event.project_id, started_sequence: event.sequence, completed_at: null,
        status: 'running', files_seen: 0, files_changed: 0, files_unchanged: 0, files_deleted: 0, parse_errors: 0, errors: [],
        metrics: { files_scanned: 0, files_parsed: 0, files_reused: 0, bytes_read: 0, symbols_extracted: 0, edges_extracted: 0, duration_ms: 0 } });
      pending.set(payload.index_run_id, new Map());
    } else if (event.event_type === 'code.file.observed' || event.event_type === 'code.file.deleted') {
      const payload = codePayloadSchemas[event.event_type].parse(event.payload);
      const run = runs.get(payload.index_run_id); const changes = pending.get(payload.index_run_id);
      if (!run || run.status !== 'running' || !changes || changes.has(payload.path)) throw new Error('Invalid file observation lifecycle');
      if ('previous_content_hash' in payload) {
        if (active.get(payload.path)?.content_hash !== payload.previous_content_hash) throw new Error('Deleted file version does not match current evidence');
        changes.set(payload.path, null);
      } else changes.set(payload.path, { ...payload, event_id: event.id, sequence: event.sequence });
    } else if (event.event_type === 'code.index.completed' || event.event_type === 'code.index.failed') {
      const payload = codePayloadSchemas[event.event_type].parse(event.payload);
      const run = runs.get(payload.index_run_id); const changes = pending.get(payload.index_run_id);
      if (!run || run.status !== 'running' || !changes) throw new Error('Index run is not running');
      const changed = [...changes.values()].filter(Boolean).length;
      const deleted = changes.size - changed;
      if (payload.files_changed !== changed || payload.files_deleted !== deleted || payload.files_seen < payload.files_changed + payload.files_unchanged ||
        payload.metrics.files_scanned !== payload.files_seen || payload.metrics.files_reused !== payload.files_unchanged) throw new Error('Index run counters do not match observations');
      if (event.event_type === 'code.index.completed' && (payload.parse_errors || payload.errors.length || payload.files_seen !== payload.files_changed + payload.files_unchanged)) throw new Error('Cannot complete a partial index');
      if (event.event_type === 'code.index.completed' && payload.files_unchanged !== [...active.keys()].filter((path) => !changes.has(path)).length) throw new Error('Successful run must account for every active file');
      if (event.event_type === 'code.index.failed' && !payload.errors.length) throw new Error('Failed index must retain an explicit error');
      runs.set(run.index_run_id, { ...run, ...payload, status: event.event_type === 'code.index.completed' ? 'completed' : 'failed' });
      if (event.event_type === 'code.index.completed') for (const [path, observation] of changes) {
        if (observation) active.set(path, observation); else active.delete(path);
      }
    }
  }
  return { active, runs: [...runs.values()], last_event_sequence };
}
