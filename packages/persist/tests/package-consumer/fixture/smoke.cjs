const assert = require('node:assert/strict');

const { createUkladRuntime } = require('@ukladjs/core/vanilla');
const { createUkladTestHarness } = require('@ukladjs/core/testing');
const { persist } = require('@ukladjs/persist');

const entries = new Map([['packed/count', JSON.stringify({ v: 1, data: 41 })]]);
const storage = {
  sync: true,
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => entries.set(key, value),
  removeItem: (key) => entries.delete(key),
};
const runtime = createUkladRuntime({ initialState: { count: 0 } });
const testHarness = createUkladTestHarness(runtime);
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
