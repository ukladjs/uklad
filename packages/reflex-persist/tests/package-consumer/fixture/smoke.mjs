import assert from 'node:assert/strict';

import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';
import { persist } from '@flexsurfer/reflex-persist';

const entries = new Map([['packed/count', JSON.stringify({ v: 1, data: 41 })]]);
const storage = {
  sync: true,
  getItem: (key) => entries.get(key) ?? null,
  setItem: (key, value) => entries.set(key, value),
  removeItem: (key) => entries.delete(key),
};
const runtime = createReflexRuntime({ initialDb: { count: 0 } });
const handle = persist(runtime, { storage, prefix: 'packed', keys: ['count'] });
runtime.regEvent('increment', ({ draftDb }) => {
  draftDb.count += 1;
});

handle.hydrate();
runtime.dispatchSync(['increment']);

assert.equal(runtime.getAppDb().count, 42);
assert.equal(entries.get('packed/count'), JSON.stringify({ v: 1, data: 42 }));
handle.dispose();
runtime.dispose();
