/**
 * Development keeps the same borrowed-event path as production. Ownership is
 * an authoring contract, so the ordinary dispatch path does not walk or freeze
 * event graphs just to report a misuse.
 */
// IS_DEV is captured at import time; Jest hoists this mock for this boundary.
jest.mock('../../src/core/environment', () => ({ IS_DEV: true }));

import { createReflexRuntimeForTests } from '../../src/runtime/runtime';

function createRuntime() {
  const runtime = createReflexRuntimeForTests({
    initialState: { seen: null as unknown },
    runtimeId: `own-${Math.random().toString(36).slice(2)}`,
  });
  const received: unknown[] = [];
  runtime.registerModule((registrar) => {
    registrar.regEvent('own/record', ({ draftState }, payload: any) => {
      received.push(payload);
      draftState.seen = payload?.title ?? 'ran';
    });
    registrar.regEvent('own/plain', ({ draftState }) => {
      draftState.seen = 'ran';
    });
  });
  return { runtime, received };
}

describe('dispatched events in development', () => {
  it('borrows event values without copying or deep-freezing them', async () => {
    const { runtime, received } = createRuntime();
    const payload = { title: 'original', tags: ['a'] };
    const event: any[] = ['own/record', payload];

    runtime.dispatch(event as never);

    expect(Object.isFrozen(event)).toBe(false);
    expect(Object.isFrozen(payload)).toBe(false);
    expect(Object.isFrozen(payload.tags)).toBe(false);

    await runtime.flush();
    expect(runtime.getState().seen).toBe('original');
    expect(Object.isFrozen(runtime.getState())).toBe(false);
    expect(received[0]).toBe(payload);
    runtime.dispose();
  });
});
