import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUkladRuntimeForTests } from '@ukladjs/core/internal';
import { createUkladTestHarness } from '@ukladjs/core/testing';
import type { UkladDisposer, UkladRuntime } from '@ukladjs/core/vanilla';
import type { UkladTestHarness } from '@ukladjs/core/testing';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';
import { createInitialState } from '../../app/uklad/initial-state';
import { registerFeatureModules } from '../../app/uklad/register';
import type {
  ServerClock,
  ServerItem,
  ServerRegion,
  ServerQueryResult,
  ServerRegionSummary,
} from '../../features/server/state';
import type { PlaygroundServerApi } from '../web/server-api';
import {
  createPlaygroundQueryClient,
  installServerQueries,
  playgroundServerKeys,
} from '../web/server-queries';

type TestRuntime = UkladRuntime<AppContracts> & {
  getState(): AppContracts['state'];
  getStateRevisions(): {
    readonly committedRevision: number;
    readonly publishedRevision: number;
  };
  getSubscriptionDiagnostics(): readonly {
    readonly query: readonly unknown[];
    readonly kind: string;
  }[];
};

const cachedClock: ServerClock = {
  tick: 7,
  serverTime: new Date(7_000).toISOString(),
};
const cachedItemOne: ServerItem = {
  id: 1,
  title: 'Cached item 1',
  requestCount: 4,
  serverTime: new Date(8_000).toISOString(),
};
const cachedItemTwo: ServerItem = {
  id: 2,
  title: 'Cached item 2',
  requestCount: 5,
  serverTime: new Date(9_000).toISOString(),
};
const cachedEu: ServerRegionSummary = {
  region: 'eu',
  city: 'Berlin',
  temperatureC: 21,
  requestCount: 3,
  serverTime: new Date(10_000).toISOString(),
};
const cachedUs: ServerRegionSummary = {
  region: 'us',
  city: 'New York',
  temperatureC: 25,
  requestCount: 6,
  serverTime: new Date(11_000).toISOString(),
};

let runtime: TestRuntime;
let harness: UkladTestHarness<AppContracts>;
let queryClient: ReturnType<typeof createPlaygroundQueryClient>;
let disposeQueries: UkladDisposer;
let stopWatching: UkladDisposer[];
let api: ReturnType<typeof createFakeApi>;

beforeEach(() => {
  runtime = createUkladRuntimeForTests<AppContracts>({
    initialState: createInitialState(),
    runtimeId: 'server-query-test',
    name: 'Server Query Test',
  });
  registerFeatureModules(runtime);
  queryClient = createPlaygroundQueryClient();
  api = createFakeApi();
  disposeQueries = installServerQueries(runtime, queryClient, api);
  harness = createUkladTestHarness(runtime);
  stopWatching = [];
});

afterEach(() => {
  for (const stop of stopWatching.reverse()) stop();
  disposeQueries();
  runtime.dispose();
  queryClient.clear();
});

describe('playground server query subscriptions', () => {
  it('reads hydrated clock, item, and region data without observers or mirrored state', () => {
    seedQueryCache();
    const beforeRead = runtime.getStateRevisions();

    expect(queryObserverCount(playgroundServerKeys.clock())).toBe(0);
    expect(harness.getSubscriptionValue([appIds.subscriptions.serverClock])).toEqual({
      kind: 'ready',
      data: cachedClock,
    });
    expect(
      harness.getSubscriptionValue([appIds.subscriptions.serverItemById, cachedItemOne.id]),
    ).toEqual({
      kind: 'ready',
      data: cachedItemOne,
    });
    expect(harness.getSubscriptionValue([appIds.subscriptions.serverRegionSummary])).toEqual({
      kind: 'ready',
      data: cachedEu,
    });

    expect(api.clock).not.toHaveBeenCalled();
    expect(api.item).not.toHaveBeenCalled();
    expect(api.region).not.toHaveBeenCalled();
    expect(queryObserverCount(playgroundServerKeys.clock())).toBe(0);
    expect(queryObserverCount(playgroundServerKeys.item(cachedItemOne.id))).toBe(0);
    expect(queryObserverCount(playgroundServerKeys.region('eu'))).toBe(0);
    expect(runtime.getState()).toEqual(expect.objectContaining({ serverRegion: 'eu' }));
    expect(Object.keys(runtime.getState())).not.toEqual(
      expect.arrayContaining(['serverClock', 'serverItems', 'serverRegionSummary']),
    );
    const diagnostics = runtime.getSubscriptionDiagnostics();
    for (const subscriptionId of [
      appIds.subscriptions.serverClock,
      appIds.subscriptions.serverItemById,
      appIds.subscriptions.serverRegionSummary,
    ]) {
      expect(diagnostics.find((diagnostic) => diagnostic.query[0] === subscriptionId)?.kind).toBe(
        'external',
      );
    }
    expect(
      diagnostics.some((diagnostic) =>
        ['serverClock', 'serverItems', 'serverRegionSummary'].includes(String(diagnostic.query[0])),
      ),
    ).toBe(false);
    expect(runtime.getStateRevisions()).toEqual(beforeRead);
  });

  it('activates the polling clock only while it has a consumer', async () => {
    queryClient.removeQueries({ queryKey: playgroundServerKeys.clock() });

    const renderedValues: ServerQueryResult<ServerClock>[] = [];
    const stop = harness.watchSubscription([appIds.subscriptions.serverClock], (value) =>
      renderedValues.push(value),
    );
    stopWatching.push(stop);

    expect(queryObserverCount(playgroundServerKeys.clock())).toBe(1);
    await waitForQueryState();
    expect(api.clock).toHaveBeenCalledTimes(1);
    expect(renderedValues.at(-1)).toEqual({
      kind: 'ready',
      data: expect.objectContaining({ tick: 1 }),
    });

    await queryClient.invalidateQueries({ queryKey: playgroundServerKeys.clock() });
    await waitForQueryState();
    expect(api.clock).toHaveBeenCalledTimes(2);

    stop();
    expect(queryObserverCount(playgroundServerKeys.clock())).toBe(0);
    await queryClient.invalidateQueries({ queryKey: playgroundServerKeys.clock() });
    await waitForQueryState();
    expect(api.clock).toHaveBeenCalledTimes(2);
  });

  it('keeps parameterized item vectors isolated and releases each observer independently', () => {
    queryClient.setQueryData(playgroundServerKeys.item(cachedItemOne.id), cachedItemOne);
    queryClient.setQueryData(playgroundServerKeys.item(cachedItemTwo.id), cachedItemTwo);

    const stopFirst = harness.watchSubscription(
      [appIds.subscriptions.serverItemById, cachedItemOne.id],
      () => {},
    );
    const stopSecond = harness.watchSubscription(
      [appIds.subscriptions.serverItemById, cachedItemTwo.id],
      () => {},
    );
    stopWatching.push(stopFirst, stopSecond);

    expect(queryObserverCount(playgroundServerKeys.item(cachedItemOne.id))).toBe(1);
    expect(queryObserverCount(playgroundServerKeys.item(cachedItemTwo.id))).toBe(1);
    expect(api.item).not.toHaveBeenCalled();
    expect(
      harness.getSubscriptionValue([appIds.subscriptions.serverItemById, cachedItemOne.id]),
    ).toEqual({ kind: 'ready', data: cachedItemOne });
    expect(
      harness.getSubscriptionValue([appIds.subscriptions.serverItemById, cachedItemTwo.id]),
    ).toEqual({ kind: 'ready', data: cachedItemTwo });

    stopFirst();
    expect(queryObserverCount(playgroundServerKeys.item(cachedItemOne.id))).toBe(0);
    expect(queryObserverCount(playgroundServerKeys.item(cachedItemTwo.id))).toBe(1);

    stopSecond();
    expect(queryObserverCount(playgroundServerKeys.item(cachedItemTwo.id))).toBe(0);
    expect(
      harness.getSubscriptionValue([appIds.subscriptions.serverItemById, cachedItemOne.id]),
    ).toEqual({ kind: 'ready', data: cachedItemOne });
    expect(runtime.getState()).not.toHaveProperty('serverItems');
  });

  it('switches region through a declared dependency and keeps query updates out of state revisions', async () => {
    queryClient.setQueryData(playgroundServerKeys.region('eu'), cachedEu);
    queryClient.setQueryData(playgroundServerKeys.region('us'), cachedUs);

    const renderedValues: ServerQueryResult<ServerRegionSummary>[] = [];
    const stop = harness.watchSubscription([appIds.subscriptions.serverRegionSummary], (value) =>
      renderedValues.push(value),
    );
    stopWatching.push(stop);

    expect(harness.getSubscriptionValue([appIds.subscriptions.serverRegionSummary])).toEqual({
      kind: 'ready',
      data: cachedEu,
    });
    expect(queryObserverCount(playgroundServerKeys.region('eu'))).toBe(1);
    expect(queryObserverCount(playgroundServerKeys.region('us'))).toBe(0);

    const beforeSelection = runtime.getStateRevisions();
    harness.dispatchSync([appIds.events.serverRegionSelected, 'us']);

    expect(harness.getSubscriptionValue([appIds.subscriptions.serverRegionSummary])).toEqual({
      kind: 'ready',
      data: cachedUs,
    });
    expect(queryObserverCount(playgroundServerKeys.region('eu'))).toBe(0);
    expect(queryObserverCount(playgroundServerKeys.region('us'))).toBe(1);
    expect(api.region).not.toHaveBeenCalled();

    const afterSelection = runtime.getStateRevisions();
    expect(afterSelection.committedRevision).toBe(beforeSelection.committedRevision + 1);

    const updatedUs: ServerRegionSummary = { ...cachedUs, temperatureC: 99 };
    queryClient.setQueryData(playgroundServerKeys.region('us'), updatedUs);
    await waitForQueryState();
    expect(harness.getSubscriptionValue([appIds.subscriptions.serverRegionSummary])).toEqual({
      kind: 'ready',
      data: updatedUs,
    });
    expect(renderedValues.at(-1)).toEqual({ kind: 'ready', data: updatedUs });
    expect(runtime.getStateRevisions()).toEqual(afterSelection);

    queryClient.removeQueries({ queryKey: playgroundServerKeys.region('apac') });
    harness.dispatchSync([appIds.events.serverRegionSelected, 'apac']);
    expect(harness.getSubscriptionValue([appIds.subscriptions.serverRegionSummary])).toEqual({
      kind: 'loading',
    });
    const afterApacSelection = runtime.getStateRevisions();
    expect(afterApacSelection.committedRevision).toBe(afterSelection.committedRevision + 1);

    await waitForQueryState();
    expect(api.region).toHaveBeenLastCalledWith('apac', expect.any(AbortSignal));
    expect(harness.getSubscriptionValue([appIds.subscriptions.serverRegionSummary])).toEqual({
      kind: 'ready',
      data: expect.objectContaining({ region: 'apac' }),
    });
    expect(runtime.getStateRevisions()).toEqual(afterApacSelection);
  });
});

async function waitForQueryState(): Promise<void> {
  for (let index = 0; index < 5; index++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await harness.flush();
  }
}

function seedQueryCache(): void {
  queryClient.setQueryData(playgroundServerKeys.clock(), cachedClock);
  queryClient.setQueryData(playgroundServerKeys.item(cachedItemOne.id), cachedItemOne);
  queryClient.setQueryData(playgroundServerKeys.item(cachedItemTwo.id), cachedItemTwo);
  queryClient.setQueryData(playgroundServerKeys.region('eu'), cachedEu);
  queryClient.setQueryData(playgroundServerKeys.region('us'), cachedUs);
}

function queryObserverCount(queryKey: readonly unknown[]): number {
  return queryClient.getQueryCache().find({ queryKey })?.getObserversCount() ?? 0;
}

function createFakeApi(): PlaygroundServerApi & {
  clock: ReturnType<typeof vi.fn<PlaygroundServerApi['clock']>>;
  item: ReturnType<typeof vi.fn<PlaygroundServerApi['item']>>;
  region: ReturnType<typeof vi.fn<PlaygroundServerApi['region']>>;
} {
  let clockTick = 0;
  const itemRequests = new Map<number, number>();
  const regionRequests = new Map<ServerRegion, number>();
  return {
    clock: vi.fn(async () => ({
      tick: ++clockTick,
      serverTime: new Date(clockTick * 1_000).toISOString(),
    })),
    item: vi.fn(async (itemId: number) => {
      const requestCount = (itemRequests.get(itemId) ?? 0) + 1;
      itemRequests.set(itemId, requestCount);
      return {
        id: itemId,
        title: `Item ${itemId}`,
        requestCount,
        serverTime: new Date(requestCount * 1_000).toISOString(),
      };
    }),
    region: vi.fn(async (region: ServerRegion) => {
      const requestCount = (regionRequests.get(region) ?? 0) + 1;
      regionRequests.set(region, requestCount);
      return {
        region,
        city: region.toUpperCase(),
        temperatureC: 20,
        requestCount,
        serverTime: new Date(requestCount * 1_000).toISOString(),
      };
    }),
  };
}
