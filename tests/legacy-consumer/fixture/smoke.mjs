// Runtime smoke test for ESM consumers: drives a real event -> app-db ->
// subscription cycle against the packed tarball, not the repo sources.
import assert from 'node:assert';
import {
  dispatchSync,
  getAppDb,
  getSubscriptionValue,
  initAppDb,
  regEvent,
  regSub,
} from '@flexsurfer/reflex';

initAppDb({ count: 0 });
regEvent('inc', ({ draftDb }) => {
  draftDb.count += 1;
});
regSub('count');
regSub(
  'doubled',
  (count) => count * 2,
  () => [['count']],
);

dispatchSync(['inc']);

assert.strictEqual(getAppDb().count, 1);
assert.strictEqual(getSubscriptionValue(['count']), 1);
assert.strictEqual(getSubscriptionValue(['doubled']), 2);

console.log('[legacy] ESM runtime smoke passed');
