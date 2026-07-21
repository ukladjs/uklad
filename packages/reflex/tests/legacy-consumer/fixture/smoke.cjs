// Runtime smoke test for CommonJS consumers: drives a real event -> app-db ->
// subscription cycle against the packed tarball, not the repo sources.
const assert = require('node:assert');
const reflex = require('@flexsurfer/reflex');
const reflexReact = require('@flexsurfer/reflex/react');
const reflexVanilla = require('@flexsurfer/reflex/vanilla');

assert.strictEqual(typeof reflex.createReflexRuntime, 'function');
assert.strictEqual(typeof reflex.useSubscription, 'function');
assert.strictEqual(reflex.defaultRuntime, undefined);
assert.strictEqual(reflex.ReflexProvider, reflexReact.ReflexProvider);

const runtime = reflex.createReflexRuntime({ initialDb: { count: 0 } });
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

console.log('[explicit] CommonJS runtime smoke passed');
