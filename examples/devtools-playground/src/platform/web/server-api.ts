import type {
  ServerClock,
  ServerItem,
  ServerRegion,
  ServerRegionSummary,
} from '../../features/server/state';

export interface PlaygroundServerApi {
  clock(signal?: AbortSignal): Promise<ServerClock>;
  item(itemId: number, signal?: AbortSignal): Promise<ServerItem>;
  region(region: ServerRegion, signal?: AbortSignal): Promise<ServerRegionSummary>;
}

/** Browser boundary for the local API started with the playground. */
export const playgroundServerApi: PlaygroundServerApi = {
  async clock(signal): Promise<ServerClock> {
    return parseClock(await request('/api/playground/clock', signal));
  },
  async item(itemId, signal): Promise<ServerItem> {
    return parseItem(await request(`/api/playground/items/${itemId}`, signal));
  },
  async region(region, signal): Promise<ServerRegionSummary> {
    return parseRegion(await request(`/api/playground/regions/${region}`, signal));
  },
};

async function request(pathname: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(pathname, { signal });
  if (!response.ok) {
    const problem = await response
      .json()
      .then((value) =>
        isRecord(value) && typeof value.error === 'string' ? value.error : undefined,
      )
      .catch(() => undefined);
    throw new Error(problem ?? `Playground API returned ${response.status}.`);
  }
  return response.json() as Promise<unknown>;
}

function parseClock(value: unknown): ServerClock {
  if (!isRecord(value) || typeof value.tick !== 'number' || typeof value.serverTime !== 'string') {
    throw new Error('Playground API returned an invalid clock.');
  }
  return { tick: value.tick, serverTime: value.serverTime };
}

function parseItem(value: unknown): ServerItem {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    typeof value.title !== 'string' ||
    typeof value.requestCount !== 'number' ||
    typeof value.serverTime !== 'string'
  ) {
    throw new Error('Playground API returned an invalid item.');
  }
  return {
    id: value.id,
    title: value.title,
    requestCount: value.requestCount,
    serverTime: value.serverTime,
  };
}

function parseRegion(value: unknown): ServerRegionSummary {
  if (
    !isRecord(value) ||
    !isServerRegion(value.region) ||
    typeof value.city !== 'string' ||
    typeof value.temperatureC !== 'number' ||
    typeof value.requestCount !== 'number' ||
    typeof value.serverTime !== 'string'
  ) {
    throw new Error('Playground API returned an invalid region summary.');
  }
  return {
    region: value.region,
    city: value.city,
    temperatureC: value.temperatureC,
    requestCount: value.requestCount,
    serverTime: value.serverTime,
  };
}

function isServerRegion(value: unknown): value is ServerRegion {
  return value === 'eu' || value === 'us' || value === 'apac';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
