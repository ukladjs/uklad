// Runtime smoke test for ESM consumers: drives a real event -> state ->
// subscription cycle against the packed tarball, not the repo sources.
import assert from 'node:assert';
import { UkladProvider, createUkladRuntime } from '@ukladjs/core';
import { createUkladTestHarness } from '@ukladjs/core/testing';
import { UkladProvider as subpathUkladProvider } from '@ukladjs/core/react';

assert.strictEqual(UkladProvider, subpathUkladProvider);

const runtime = createUkladRuntime({ initialState: { count: 0 } });
const testHarness = createUkladTestHarness(runtime);
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
