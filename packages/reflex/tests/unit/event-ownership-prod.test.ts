/**
 * Production pays nothing for the immutable-event contract.
 *
 * The development freeze is a diagnostic, not a semantic: outside development
 * the runtime neither copies nor freezes a dispatched payload, so a caller's
 * objects are never altered by having been dispatched.
 */
jest.mock('../../src/core/environment', () => ({ IS_DEV: false }));

import { createReflexRuntimeForTests } from '../../src/runtime/runtime';

describe('dispatched events outside development', () => {
  it('neither copies nor freezes the dispatched payload', async () => {
    const runtime = createReflexRuntimeForTests({
      initialState: { seen: null as unknown },
      runtimeId: 'own-prod',
    });
    const received: unknown[] = [];
    runtime.registerModule((registrar) => {
      registrar.regEvent('own/record', ({ draftState }, payload: any) => {
        received.push(payload);
        draftState.seen = payload.title;
      });
    });

    const payload = { title: 'original', tags: ['a'] };
    runtime.dispatch(['own/record', payload]);

    expect(Object.isFrozen(payload)).toBe(false);
    expect(() => {
      payload.tags.push('b');
    }).not.toThrow();

    await runtime.flush();

    // Same reference, and the runtime made no defensive copy of it.
    expect(received[0]).toBe(payload);
    runtime.dispose();
  });
});
