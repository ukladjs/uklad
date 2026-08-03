/**
 * The runtime-wide event error handler.
 *
 * `setEventErrorHandler` overrides the built-in handler, which logs the
 * failure and rethrows it. `clearEventErrorHandler` must restore that baseline
 * rather than leave the runtime with no handler at all.
 */
import { createUkladRuntimeForTests } from '../../src/runtime/runtime';

function createRuntime(runtimeId: string) {
  const runtime = createUkladRuntimeForTests({ initialState: { count: 0 }, runtimeId });
  runtime.registerModule((registrar) => {
    registrar.regEvent('boom', () => {
      throw new Error('handler exploded');
    });
    registrar.regEvent('fine', ({ draftState }) => {
      draftState.count += 1;
    });
  });
  return runtime;
}

describe('event error handler', () => {
  it('rethrows through the built-in handler by default', () => {
    const runtime = createRuntime('error-default');
    expect(() => runtime.dispatchSync(['boom'])).toThrow('handler exploded');
    runtime.dispose();
  });

  it('routes failures to an override instead of throwing', () => {
    const runtime = createRuntime('error-override');
    const seen: Error[] = [];
    runtime.setEventErrorHandler((originalError) => {
      seen.push(originalError);
    });

    expect(() => runtime.dispatchSync(['boom'])).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toBe('handler exploded');

    // The runtime keeps working after a recovered failure.
    runtime.dispatchSync(['fine']);
    expect(runtime.getState().count).toBe(1);
    runtime.dispose();
  });

  it('restores the built-in handler when the override is cleared', () => {
    const runtime = createRuntime('error-restore');
    const seen: Error[] = [];
    runtime.setEventErrorHandler((originalError) => {
      seen.push(originalError);
    });
    runtime.dispatchSync(['boom']);
    expect(seen).toHaveLength(1);

    runtime.clearEventErrorHandler();

    // Back to the baseline: the failure surfaces to the caller again, and the
    // cleared override no longer sees it.
    expect(() => runtime.dispatchSync(['boom'])).toThrow('handler exploded');
    expect(seen).toHaveLength(1);
    runtime.dispose();
  });

  it('is idempotent when no override is installed', () => {
    const runtime = createRuntime('error-clear-twice');
    runtime.clearEventErrorHandler();
    runtime.clearEventErrorHandler();
    expect(() => runtime.dispatchSync(['boom'])).toThrow('handler exploded');
    runtime.dispose();
  });
});
