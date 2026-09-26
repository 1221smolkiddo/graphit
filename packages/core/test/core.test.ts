import { describe, expect, it } from 'vitest';
import {
  applyEvent, canonicalJson, contentHash, createEvent, emptyState, reconstructState, verifyEvent,
} from '@graphit/core';

const project_id = '00000000-0000-4000-8000-000000000001';
const session_id = '00000000-0000-4000-8000-000000000002';
const created_at = '2026-09-26T00:00:00.000Z';
const initial = { project_id, session_id, created_at, sequence: 1,
  event_type: 'project.created', payload: { name: 'Graphit', root_path: '/repo' } };

describe('canonical event identity', () => {
  it('sorts nested keys, preserves array order and hashes deterministically', () => {
    expect(canonicalJson({ b: [{ d: 2, c: 1 }], a: 0 })).toBe('{"a":0,"b":[{"c":1,"d":2}]}');
    const first = createEvent(initial);
    const second = createEvent({ ...initial, payload: { root_path: '/repo', name: 'Graphit' } });
    expect(first).toEqual(second);
    expect(first.id).toMatch(/^[a-f0-9]{64}$/);
    expect(first.content_hash).toBe(contentHash(initial));
    expect(createEvent({ ...initial, sequence: 2 }).id).not.toBe(first.id);
    expect(createEvent({ ...initial, created_at: '2026-09-26T00:00:00.001Z' }).id).not.toBe(first.id);
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
  });

  it.each([undefined, NaN, Infinity, 1n, new Date(), { a: undefined }, [undefined], Array(1)])(
    'rejects non-JSON values: %s', (value) => {
      expect(() => canonicalJson(value)).toThrow();
    },
  );

  it('rejects cycles and symbol keys', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow('Cyclic');
    expect(() => canonicalJson({ [Symbol('hidden')]: 1 })).toThrow('Symbol');
  });

  it.each([
    { event_type: 'unknown' }, { payload: {} }, { payload: { name: '', root_path: '/repo' } },
    { payload: { name: 'x', root_path: '/repo', extra: 1 } }, { payload: null },
    { payload: { name: 123, root_path: '/repo' } }, { sequence: 0 }, { sequence: 1.5 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 }, { session_id: '' }, { project_id: 'invalid' },
    { created_at: 'yesterday' }, { created_at: '2026-09-26T00:00:00Z' }, { extra: true },
  ])('fails closed on malformed event input %j', (override) => {
    expect(() => createEvent({ ...initial, ...override })).toThrow();
  });

  it('detects content, identity and timestamp tampering', () => {
    const event = createEvent(initial);
    expect(verifyEvent(event)).toEqual(event);
    expect(() => verifyEvent({ ...event, id: '0'.repeat(64) })).toThrow('integrity');
    expect(() => verifyEvent({ ...event, content_hash: '0'.repeat(64) })).toThrow('integrity');
    expect(() => verifyEvent({ ...event, created_at: '2026-09-27T00:00:00.000Z' })).toThrow('integrity');
    expect(() => verifyEvent({ ...event, payload: { name: 'tampered', root_path: '/repo' } })).toThrow('integrity');
  });
});

describe('event replay', () => {
  const project = createEvent(initial);
  const session = createEvent({ ...initial, sequence: 2, event_type: 'session.started', payload: {} });

  it('reconstructs deterministic state without mutating prior state', () => {
    const empty = emptyState();
    const state = applyEvent(empty, project);
    expect(empty.project).toBeNull();
    expect(state.project?.name).toBe('Graphit');
    expect(reconstructState([project, session])).toEqual(reconstructState([project, session]));
    expect(reconstructState([project, session]).active_session_id).toBe(session_id);
  });

  it('verifies checkpoint state and reconstructs resumed sessions', () => {
    const before = reconstructState([project, session]);
    const checkpoint = createEvent({ ...initial, sequence: 3, event_type: 'checkpoint.created',
      payload: { name: 'ready', through_sequence: 2, state_hash: contentHash(before) } });
    const resume = createEvent({ ...initial, session_id: '00000000-0000-4000-8000-000000000003', sequence: 4,
      event_type: 'session.resumed', payload: { checkpoint_id: checkpoint.id } });
    const state = reconstructState([project, session, checkpoint, resume]);
    expect(state.last_sequence).toBe(4);
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[1]?.resumed_from_checkpoint_id).toBe(checkpoint.id);
    expect(state.checkpoints[0]?.through_sequence).toBe(2);
  });

  it('rejects gaps, duplicate events, mixed projects and impossible transitions', () => {
    expect(() => reconstructState([session])).toThrow('sequence');
    expect(() => reconstructState([project, project])).toThrow('sequence');
    expect(() => reconstructState([createEvent({ ...initial, event_type: 'session.started', payload: {} })])).toThrow('first');
    const other = createEvent({ ...initial, project_id: '00000000-0000-4000-8000-000000000003', sequence: 2 });
    expect(() => reconstructState([project, other])).toThrow('Cross-project');
    expect(() => reconstructState([project, createEvent({ ...initial, sequence: 2 })])).toThrow('already exists');
    const duplicateSession = createEvent({ ...initial, sequence: 3, event_type: 'session.started', payload: {} });
    expect(() => reconstructState([project, session, duplicateSession])).toThrow('Session already exists');
  });

  it('rejects missing checkpoints, inactive sessions and forged checkpoint claims', () => {
    const checkpoint = { ...initial, sequence: 3, event_type: 'checkpoint.created',
      payload: { name: 'bad', through_sequence: 2, state_hash: '0'.repeat(64) } };
    expect(() => reconstructState([project, session, createEvent(checkpoint)])).toThrow('preceding event state');
    expect(() => reconstructState([project, session, createEvent({ ...checkpoint,
      session_id: '00000000-0000-4000-8000-000000000004' })])).toThrow('active session');
    const resume = createEvent({ ...initial, sequence: 3, session_id: '00000000-0000-4000-8000-000000000004',
      event_type: 'session.resumed', payload: { checkpoint_id: '0'.repeat(64) } });
    expect(() => reconstructState([project, session, resume])).toThrow('Checkpoint does not exist');
  });
});
