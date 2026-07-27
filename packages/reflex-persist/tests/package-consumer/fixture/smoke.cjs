const assert = require('node:assert/strict');

const { createReflexRuntime } = require('@flexsurfer/reflex/vanilla');
const { createReflexTestHarness } = require('@flexsurfer/reflex/testing');
const { persist } = require('@flexsurfer/reflex-persist');

const entries = new Map([['packed/count', JSON.stringify({ v: 1, data: 41 })]]);
const storage = {
  sync: true,
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => entries.set(key, value),
  removeItem: (key) => entries.delete(key),
};
const runtime = createReflexRuntime({ initialState: { count: 0 } });
const testHarness = createReflexTestHarness(runtime);
const handle = persist(runtime, { storage, prefix: 'packed', keys: ['count'] });
runtime.registerModule((registrar) => {
  registrar.regEvent('increment', ({ draftState }) => {
    draftState.count += 1;
  });
});

handle.hydrate();
testHarness.dispatchSync(['increment']);

assert.equal(testHarness.getState().count, 42);
assert.equal(entries.get('packed/count'), JSON.stringify({ v: 1, data: 42 }));
handle.dispose();
runtime.dispose();
