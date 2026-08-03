jest.mock('../../src/core/environment', () => ({ IS_DEV: true }));

import { registerRuntimeInstance } from '../../src/duplicate-package-detection';

const RUNTIME_MARKER_KEY = Symbol.for('@ukladjs/core/runtime');

describe('duplicate Uklad runtime detection', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, RUNTIME_MARKER_KEY);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, RUNTIME_MARKER_KEY);
  });

  it('registers one runtime without warning and ignores the same instance', () => {
    const instance = {};

    registerRuntimeInstance(instance);
    registerRuntimeInstance(instance);

    expect(getTestLogCalls().warn).toEqual([]);
  });

  it('warns when a different runtime is registered in the same realm', () => {
    registerRuntimeInstance({});
    registerRuntimeInstance({});

    expect(getTestLogCalls().warn).toEqual([
      [
        expect.stringContaining(
          'Multiple copies of @ukladjs/core detected in the same JavaScript realm',
        ),
      ],
    ]);
    expect(getTestLogCalls().warn[0]![0]).toContain('separate state');
    expect(getTestLogCalls().warn[0]![0]).toContain(
      'do not mix providers, hooks, or runtime helpers',
    );
    expect(getTestLogCalls().warn[0]![0]).toContain('single copy of @ukladjs/core');
  });
});
