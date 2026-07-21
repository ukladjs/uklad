// Runtime smoke test for ESM consumers: drives a real event -> app-db ->
// subscription cycle against the packed tarball, not the repo sources.
import assert from 'node:assert';
import { ReflexProvider, createReflexRuntime } from '@flexsurfer/reflex';
import { ReflexProvider as subpathReflexProvider } from '@flexsurfer/reflex/react';

assert.strictEqual(ReflexProvider, subpathReflexProvider);

const runtime = createReflexRuntime({ initialDb: { count: 0 } });
runtime.regEvent('inc', ({ draftDb }) => {
  draftDb.count += 1;
});
runtime.regSub('count');
runtime.regSub(
  'doubled',
  (count) => count * 2,
  () => [['count']],
);

runtime.dispatchSync(['inc']);

assert.strictEqual(runtime.getAppDb().count, 1);
assert.strictEqual(runtime.getSubscriptionValue(['count']), 1);
assert.strictEqual(runtime.getSubscriptionValue(['doubled']), 2);

console.log('[explicit] ESM runtime smoke passed');
