// Runtime smoke test for CommonJS consumers: drives a real event -> state ->
// subscription cycle against the packed tarball, not the repo sources.
const assert = require('node:assert');
const uklad = require('@ukladjs/core');
const ukladReact = require('@ukladjs/core/react');
const ukladVanilla = require('@ukladjs/core/vanilla');
const ukladTesting = require('@ukladjs/core/testing');

assert.strictEqual(typeof uklad.createUkladRuntime, 'function');
assert.strictEqual(typeof uklad.useSubscription, 'function');
assert.strictEqual(uklad.defaultRuntime, undefined);
assert.strictEqual(uklad.UkladProvider, ukladReact.UkladProvider);

const runtime = uklad.createUkladRuntime({ initialState: { count: 0 } });
const testHarness = ukladTesting.createUkladTestHarness(runtime);
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

console.log('[explicit] CommonJS runtime smoke passed');
