// Runtime smoke test for CommonJS consumers: drives a real event -> state ->
// subscription cycle against the packed tarball, not the repo sources.
const assert = require('node:assert');
const reflex = require('@flexsurfer/reflex');
const reflexReact = require('@flexsurfer/reflex/react');
const reflexVanilla = require('@flexsurfer/reflex/vanilla');
const reflexTesting = require('@flexsurfer/reflex/testing');

assert.strictEqual(typeof reflex.createReflexRuntime, 'function');
assert.strictEqual(typeof reflex.useSubscription, 'function');
assert.strictEqual(reflex.defaultRuntime, undefined);
assert.strictEqual(reflex.ReflexProvider, reflexReact.ReflexProvider);

const runtime = reflex.createReflexRuntime({ initialState: { count: 0 } });
const testHarness = reflexTesting.createReflexTestHarness(runtime);
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
    (count) => count * 2,
    () => [['count']],
  );
});

testHarness.dispatchSync(['inc']);

assert.strictEqual(testHarness.getState().count, 1);
assert.strictEqual(testHarness.getSubscriptionValue(['count']), 1);
assert.strictEqual(testHarness.getSubscriptionValue(['doubled']), 2);

console.log('[explicit] CommonJS runtime smoke passed');
