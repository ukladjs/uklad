// Runtime smoke test for CommonJS consumers: drives a real event -> app-db ->
// subscription cycle against the packed tarball, not the repo sources.
const assert = require('node:assert');
const reflex = require('@flexsurfer/reflex');

assert.strictEqual(typeof reflex.dispatch, 'function');
assert.strictEqual(typeof reflex.regEvent, 'function');
assert.strictEqual(typeof reflex.useSubscription, 'function');

reflex.initAppDb({ count: 0 });
reflex.regEvent('inc', ({ draftDb }) => {
  draftDb.count += 1;
});
reflex.regSub('count');
reflex.regSub(
  'doubled',
  (count) => count * 2,
  () => [['count']],
);

reflex.dispatchSync(['inc']);

assert.strictEqual(reflex.getAppDb().count, 1);
assert.strictEqual(reflex.getSubscriptionValue(['count']), 1);
assert.strictEqual(reflex.getSubscriptionValue(['doubled']), 2);

console.log('[legacy] CommonJS runtime smoke passed');
