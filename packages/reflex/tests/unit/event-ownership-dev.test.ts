/**
 * Development enforcement of the immutable-event contract.
 *
 * `dispatch` no longer deep-copies its payload, so the contract is that a
 * dispatched value belongs to the runtime from the call onward. Development
 * freezes it, turning a violation into a TypeError at the mutation site
 * instead of a handler that silently observes some later value.
 */
// IS_DEV is captured at import time; Jest hoists this mock so the freeze runs.
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

describe('dispatched events are frozen in development', () => {
  it('rejects mutation of a dispatched payload at the mutation site', async () => {
    const { runtime } = createRuntime();
    const payload = { title: 'original', tags: ['a'] };

    runtime.dispatch(['own/record', payload]);

    expect(() => {
      payload.title = 'mutated';
    }).toThrow(TypeError);
    // Nested values are frozen too.
    expect(() => {
      payload.tags.push('b');
    }).toThrow(TypeError);

    await runtime.flush();
    expect(runtime.getState().seen).toBe('original');
    runtime.dispose();
  });

  it('rejects mutation of the event vector itself', async () => {
    const { runtime } = createRuntime();
    const event: any[] = ['own/plain', 1];

    runtime.dispatch(event as never);

    expect(() => event.push(2)).toThrow(TypeError);
    expect(() => {
      event[1] = 9;
    }).toThrow(TypeError);

    await runtime.flush();
    runtime.dispose();
  });

  it('hands the handler the very object that was dispatched', async () => {
    const { runtime, received } = createRuntime();
    const payload = { title: 'kept' };

    runtime.dispatch(['own/record', payload]);
    await runtime.flush();

    // No copy is made: the payload arrives by reference.
    expect(received[0]).toBe(payload);
    runtime.dispose();
  });

  it('accepts payloads a structured clone would have rejected', async () => {
    class Marker {
      readonly title: string;
      constructor(title: string) {
        this.title = title;
      }
    }
    const { runtime, received } = createRuntime();

    // The previous implementation deep-copied every event and threw here.
    expect(() => runtime.dispatch(['own/record', new Marker('x')])).not.toThrow();
    await runtime.flush();

    expect((received[0] as Marker).title).toBe('x');
    runtime.dispose();
  });

  it('tolerates a cyclic payload instead of recursing forever', async () => {
    const cyclic: Record<string, unknown> = { title: 'loop' };
    cyclic.self = cyclic;
    const { runtime } = createRuntime();

    expect(() => runtime.dispatch(['own/record', cyclic])).not.toThrow();
    await runtime.flush();

    expect(runtime.getState().seen).toBe('loop');
    runtime.dispose();
  });

  it('freezes payloads reaching the queue through debounce and throttle', async () => {
    const { runtime } = createRuntime();
    const debounced = { title: 'debounced' };
    const throttled = { title: 'throttled' };

    runtime.debounceAndDispatch(['own/record', debounced], 1);
    runtime.throttleAndDispatch(['own/record', throttled], 1);

    expect(() => {
      debounced.title = 'x';
    }).toThrow(TypeError);
    expect(() => {
      throttled.title = 'x';
    }).toThrow(TypeError);

    runtime.dispose();
  });
});
