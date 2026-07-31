import { describe, expect, it } from 'vitest';

import { enableMapSet } from '@flexsurfer/reflex/vanilla';
import { createReflexTestHarness } from '@flexsurfer/reflex/testing';
import type { SyncPersistStorage } from '@flexsurfer/reflex-persist';

import { appIds } from '../../app/reflex/catalog';
import { registerFeatureModules } from '../../app/reflex/register';
import { createAppRuntime } from '../../app/reflex/runtime';
import { createTestClock } from '../test/coeffects';
import { registerWebPersistence } from './persistence';

enableMapSet();

/** A fake for the browser adapter: same synchronous contract, inspectable. */
function createFakeStorage(seed: Map<string, string> = new Map()) {
  let writes = 0;
  const storage: SyncPersistStorage = {
    sync: true,
    getItem: (key) => seed.get(key) ?? null,
    setItem: (key, value) => {
      writes += 1;
      seed.set(key, value);
    },
    removeItem: (key) => {
      seed.delete(key);
    },
  };
  return { storage, data: seed, get writes() { return writes; } };
}

describe('web persistence integration', () => {
  it('hydrates before use, writes one root, and restores it on reload', async () => {
    const fake = createFakeStorage(
      new Map([
        [
          'reflex/todosById',
          JSON.stringify({ v: 1, data: [[1, { id: 1, title: 'stored', done: false }]] }),
        ],
      ]),
    );

    // First session: the shipped feature modules, the test clock, and the real
    // persistence configuration against a fake storage.
    const firstRuntime = createAppRuntime({ runtimeId: 'todomvc.persist.first' });
    registerFeatureModules(firstRuntime);
    firstRuntime.registerModule(createTestClock(2).module);
    const firstHarness = createReflexTestHarness(firstRuntime);
    const first = registerWebPersistence(firstRuntime, fake.storage);

    first.hydrate();
    expect(firstHarness.getState().todosById.get(1)?.title).toBe('stored');

    firstRuntime.dispatch([appIds.events.todosAdd, 'new']);
    await firstHarness.flush();
    expect(fake.writes).toBe(1);
    first.dispose();
    firstRuntime.dispose();

    // Reload: a fresh runtime rebuilds the Map root from the stored tuples.
    const reloadRuntime = createAppRuntime({ runtimeId: 'todomvc.persist.reload' });
    registerFeatureModules(reloadRuntime);
    const reloadHarness = createReflexTestHarness(reloadRuntime);
    const reload = registerWebPersistence(reloadRuntime, fake.storage);
    reload.hydrate();

    expect(fake.writes).toBe(1);
    expect(reloadHarness.getState().todosById).toBeInstanceOf(Map);
    expect(Array.from(reloadHarness.getState().todosById.values())).toEqual([
      { id: 1, title: 'stored', done: false },
      { id: 2, title: 'new', done: false },
    ]);
    reload.dispose();
    reloadRuntime.dispose();
  });
});
