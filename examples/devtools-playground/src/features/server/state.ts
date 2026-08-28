/** Read models returned by the playground's local HTTP API. */

export type ServerQueryResult<TData> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: TData }
  | { readonly kind: 'error'; readonly message: string };

export interface ServerClock {
  readonly tick: number;
  readonly serverTime: string;
}

export interface ServerItem {
  readonly id: number;
  readonly title: string;
  readonly requestCount: number;
  readonly serverTime: string;
}

export type ServerRegion = 'eu' | 'us' | 'apac';

export interface ServerRegionSummary {
  readonly region: ServerRegion;
  readonly city: string;
  readonly temperatureC: number;
  readonly requestCount: number;
  readonly serverTime: string;
}

export function createServerRegion(): ServerRegion {
  return 'eu';
}
