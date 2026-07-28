// Runtime smoke test for ESM consumers: drives a real event -> state ->
// subscription cycle against the packed tarball, not the repo sources.
import assert from 'node:assert';
import { ReflexProvider, createReflexRuntime } from '@flexsurfer/reflex';
import { createReflexTestHarness } from '@flexsurfer/reflex/testing';
import { ReflexProvider as subpathReflexProvider } from '@flexsurfer/reflex/react';

assert.strictEqual(ReflexProvider, subpathReflexProvider);

const runtime = createReflexRuntime({ initialState: { count: 0 } });
const testHarness = createReflexTestHarness(runtime);
runtime.registerModule((registrar) => {
  registrar.regEvent('inc', ({ draftState }) => {
    draftState.count += 1;
  });
});
runtime.registerModule((registrar) => {
  registrar.regRootSub('count', 'count');
});
runtime.registerModule((registrar) => {
  registrar.regSub(
    'doubled',
    () => [['count']],
    ([count]) => count * 2,
  );
});

testHarness.dispatchSync(['inc']);

assert.strictEqual(testHarness.getState().count, 1);
assert.strictEqual(testHarness.getSubscriptionValue(['count']), 1);
assert.strictEqual(testHarness.getSubscriptionValue(['doubled']), 2);

console.log('[explicit] ESM runtime smoke passed');
