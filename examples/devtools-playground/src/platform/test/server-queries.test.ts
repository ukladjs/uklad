import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUkladTestHarness } from '@ukladjs/core/testing';
import type { UkladDisposer, UkladRuntime } from '@ukladjs/core/vanilla';
import type { UkladTestHarness } from '@ukladjs/core/testing';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';
import { registerFeatureModules } from '../../app/uklad/register';
import { createPlaygroundRuntime } from '../../app/uklad/runtime';
import type { ServerRegion } from '../../features/server/state';
import type { PlaygroundServerApi } from '../web/server-api';
import { createPlaygroundQueryClient, installServerQueries } from '../web/server-queries';

let runtime: UkladRuntime<AppContracts>;
let harness: UkladTestHarness<AppContracts>;
let queryClient: ReturnType<typeof createPlaygroundQueryClient>;
let disposeQueries: UkladDisposer;
let stopWatching: UkladDisposer[];
let api: ReturnType<typeof createFakeApi>;

beforeEach(() => {
  runtime = createPlaygroundRuntime({ runtimeId: 'server-query-test', name: 'Server Query Test' });
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
  it('supports timer data, query parameters, and a subscription-controlled query key', async () => {
    stopWatching.push(harness.watchSubscription([appIds.subscriptions.serverClock], () => {}));
    await waitForQueryState();
    expect(harness.getSubscriptionValue([appIds.subscriptions.serverClock])).toMatchObject({
      kind: 'ready',
      data: { tick: 1 },
    });

    const stopFirstItem = harness.watchSubscription(
      [appIds.subscriptions.serverItemById, 1],
      () => {},
    );
    await waitForQueryState();
    expect(harness.getSubscriptionValue([appIds.subscriptions.serverItemById, 1])).toMatchObject({
      kind: 'ready',
      data: { id: 1, title: 'Item 1' },
    });
    stopFirstItem();

    stopWatching.push(
      harness.watchSubscription([appIds.subscriptions.serverItemById, 2], () => {}),
    );
    await waitForQueryState();
    expect(harness.getSubscriptionValue([appIds.subscriptions.serverItemById, 2])).toMatchObject({
      kind: 'ready',
      data: { id: 2, title: 'Item 2' },
    });
    expect(api.item).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    expect(api.item).toHaveBeenCalledWith(2, expect.any(AbortSignal));

    stopWatching.push(
      harness.watchSubscription([appIds.subscriptions.serverRegionSummary], () => {}),
    );
    await waitForQueryState();
    expect(harness.getSubscriptionValue([appIds.subscriptions.serverRegionSummary])).toMatchObject({
      kind: 'ready',
      data: { region: 'eu' },
    });

    harness.dispatchSync([appIds.events.serverRegionSelected, 'us']);
    await waitForQueryState();
    expect(harness.getSubscriptionValue([appIds.subscriptions.serverRegionSummary])).toMatchObject({
      kind: 'ready',
      data: { region: 'us' },
    });
    expect(api.region).toHaveBeenLastCalledWith('us', expect.any(AbortSignal));
  });
});

async function waitForQueryState(): Promise<void> {
  for (let index = 0; index < 3; index++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 16));
    await harness.flush();
  }
}

function createFakeApi(): PlaygroundServerApi & {
  clock: ReturnType<typeof vi.fn<PlaygroundServerApi['clock']>>;
  item: ReturnType<typeof vi.fn<PlaygroundServerApi['item']>>;
  region: ReturnType<typeof vi.fn<PlaygroundServerApi['region']>>;
} {
  let clockTick = 0;
  return {
    clock: vi.fn(async () => ({
      tick: ++clockTick,
      serverTime: new Date(0).toISOString(),
    })),
    item: vi.fn(async (itemId: number) => ({
      id: itemId,
      title: `Item ${itemId}`,
      requestCount: 1,
      serverTime: new Date(0).toISOString(),
    })),
    region: vi.fn(async (region: ServerRegion) => ({
      region,
      city: region.toUpperCase(),
      temperatureC: 20,
      requestCount: 1,
      serverTime: new Date(0).toISOString(),
    })),
  };
}
