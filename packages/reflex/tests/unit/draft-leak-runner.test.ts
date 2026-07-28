// IS_DEV is captured at import time; Jest hoists this mock so the event runner
// takes its development-only draft-leak branch in this suite.
jest.mock('../../src/core/environment', () => ({ IS_DEV: true }));

import { dispatchSync, getState, initState, regEffect, regEvent } from './runtime-test-api';

describe('drafts returned inside effects', () => {
  it('snapshots a draft payload so the effect handler receives a live value', () => {
    initState({ todos: [{ id: 1, title: 'one' }], saved: 0 });

    const received: any[] = [];
    regEffect('draft-fix/save', (value) => {
      received.push(value);
    });
    regEvent('draft-fix/leaky', ({ draftState }) => {
      draftState.todos.push({ id: 2, title: 'two' });
      draftState.saved += 1;
      // The mistake this exists to absorb: returning the draft itself.
      return [['draft-fix/save', draftState.todos]];
    });

    expect(() => dispatchSync(['draft-fix/leaky'])).not.toThrow();

    expect(received).toHaveLength(1);
    // Readable after the event, which a revoked draft would not be.
    expect(received[0]).toHaveLength(2);
    expect(received[0][1].title).toBe('two');
    expect(getState().saved).toBe(1);
    // The common shape is corrected silently, not merely reported.
    expect(getTestLogCalls().warn).toHaveLength(0);
  });

  it('snapshots a draft held on a field of a wrapper object', () => {
    initState({ todos: [{ id: 1, title: 'one' }], saved: 0 });

    const received: any[] = [];
    regEffect('draft-fix/save-wrapped', (value) => {
      received.push(value);
    });
    regEvent('draft-fix/wrapped', ({ draftState }) => {
      draftState.saved += 1;
      return [['draft-fix/save-wrapped', { key: 'todos', value: draftState.todos }]];
    });

    dispatchSync(['draft-fix/wrapped']);

    expect(received[0].key).toBe('todos');
    expect(received[0].value[0].title).toBe('one');
    expect(getTestLogCalls().warn).toHaveLength(0);
  });

  it('leaves an already-plain payload untouched', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    initState({ rows, saved: 0 });

    const received: any[] = [];
    regEffect('draft-fix/plain', (value) => {
      received.push(value);
    });
    regEvent('draft-fix/plain-event', ({ draftState }) => {
      draftState.saved += 1;
      return [['draft-fix/plain', rows]];
    });

    dispatchSync(['draft-fix/plain-event']);

    // Same reference: no copying is done for payloads that hold no draft.
    expect(received[0]).toBe(rows);
    expect(getTestLogCalls().warn).toHaveLength(0);
  });

  it('warns about a draft nested inside a collection, which is not unwrapped', () => {
    initState({ todos: [{ id: 1, title: 'one' }], saved: 0 });

    regEffect('draft-fix/nested', () => {});
    regEvent('draft-fix/nested-event', ({ draftState }) => {
      draftState.saved += 1;
      // Inside an array: deliberately outside what the runtime unwraps.
      return [['draft-fix/nested', [draftState.todos[0]]]];
    });

    expect(() => dispatchSync(['draft-fix/nested-event'])).not.toThrow();

    expectLogCall('warn', expect.stringContaining("Effects returned by 'draft-fix/nested-event'"));
    expectLogCall('warn', expect.stringContaining('current()'));
    expect(getState().saved).toBe(1);
  });

  it('stays silent for a handler that returns a plain snapshot', () => {
    initState({ todos: [{ id: 1, title: 'one' }], saved: 0 });

    regEffect('draft-fix/clean', () => {});
    regEvent('draft-fix/clean-event', ({ draftState }) => {
      draftState.saved += 1;
      return [['draft-fix/clean', { count: draftState.todos.length }]];
    });

    dispatchSync(['draft-fix/clean-event']);

    expect(getTestLogCalls().warn).toHaveLength(0);
    expect(getState().saved).toBe(1);
  });
});
