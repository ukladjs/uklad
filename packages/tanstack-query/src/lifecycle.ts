import type { QueryClient } from '@tanstack/query-core';
import type {
  ContractCoeffectPayloads,
  CoeffectReadContext,
  UkladContracts,
  UkladDisposer,
  UkladRuntime,
} from '@ukladjs/core/vanilla';

import { createQueryCacheReader, type QueryCacheReader } from './read';

type QueryCacheCoeffectPayloads<TContracts extends UkladContracts> =
  ContractCoeffectPayloads<TContracts>;

type QueryCacheCoeffectId<TContracts extends UkladContracts> = Exclude<
  Extract<keyof QueryCacheCoeffectPayloads<TContracts>, string>,
  'event' | 'draftState' | '__proto__'
>;

type QueryCacheCoeffectArg<
  TContracts extends UkladContracts,
  TId extends string,
> = TId extends keyof QueryCacheCoeffectPayloads<TContracts>
  ? QueryCacheCoeffectPayloads<TContracts>[TId] extends { readonly arg: infer TArg }
    ? TArg
    : void
  : any;

type QueryCacheCoeffectValue<
  TContracts extends UkladContracts,
  TId extends string,
> = TId extends keyof QueryCacheCoeffectPayloads<TContracts>
  ? QueryCacheCoeffectPayloads<TContracts>[TId] extends { readonly value: infer TValue }
    ? TValue
    : any
  : any;

/** One package-owned cache reader registration for an application coeffect id. */
export type QueryCacheCoeffectDefinition<
  TContracts extends UkladContracts,
  TId extends QueryCacheCoeffectId<TContracts> = QueryCacheCoeffectId<TContracts>,
> =
  TId extends QueryCacheCoeffectId<TContracts>
    ? {
        readonly id: TId;
        readonly read: (
          cache: QueryCacheReader,
          arg: QueryCacheCoeffectArg<TContracts, TId>,
          context: CoeffectReadContext,
        ) => QueryCacheCoeffectValue<TContracts, TId>;
      }
    : never;

/** Options applied to one runtime/QueryClient attachment. */
export interface AttachQueryClientOptions<TContracts extends UkladContracts> {
  readonly cacheCoeffects?: readonly QueryCacheCoeffectDefinition<TContracts>[];
}

const attachedClientByRuntime = new WeakMap<object, QueryClient>();
const attachedRuntimeByClient = new WeakMap<object, object>();

/**
 * Mount a headless QueryClient for one Uklad runtime and release it with that
 * runtime's module lifecycle. This replaces QueryClientProvider's mount/
 * unmount responsibility; it does not install React context or a private
 * Query-specific state bridge.
 */
export function attachQueryClient<TContracts extends UkladContracts>(
  runtime: UkladRuntime<TContracts>,
  queryClient: QueryClient,
  options: AttachQueryClientOptions<TContracts> = {},
): UkladDisposer {
  if (typeof runtime !== 'object' || runtime === null) {
    throw new Error('[uklad-tanstack-query] attachQueryClient() requires a Uklad runtime.');
  }
  if (
    typeof queryClient !== 'object' ||
    queryClient === null ||
    typeof queryClient.mount !== 'function' ||
    typeof queryClient.unmount !== 'function'
  ) {
    throw new Error('[uklad-tanstack-query] attachQueryClient() requires a TanStack QueryClient.');
  }

  const runtimeIdentity = runtime as object;
  if (attachedClientByRuntime.has(runtimeIdentity)) {
    throw new Error(
      '[uklad-tanstack-query] A QueryClient is already attached to this Uklad runtime.',
    );
  }
  if (attachedRuntimeByClient.has(queryClient)) {
    throw new Error(
      '[uklad-tanstack-query] This QueryClient is already attached to a Uklad runtime.',
    );
  }

  assertAttachOptions(options);

  const cache = createQueryCacheReader(queryClient);

  return runtime.registerModule((registrar) => {
    for (const definition of options.cacheCoeffects ?? []) {
      registrar.regCoeffect(definition.id, (arg, context) => definition.read(cache, arg, context));
    }

    queryClient.mount();
    attachedClientByRuntime.set(runtimeIdentity, queryClient);
    attachedRuntimeByClient.set(queryClient, runtimeIdentity);
    return () => {
      try {
        queryClient.unmount();
      } finally {
        if (attachedClientByRuntime.get(runtimeIdentity) === queryClient) {
          attachedClientByRuntime.delete(runtimeIdentity);
        }
        if (attachedRuntimeByClient.get(queryClient) === runtimeIdentity) {
          attachedRuntimeByClient.delete(queryClient);
        }
      }
    };
  });
}

function assertAttachOptions<TContracts extends UkladContracts>(
  options: AttachQueryClientOptions<TContracts>,
): void {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('[uklad-tanstack-query] attachQueryClient() options must be an object.');
  }

  const definitions = options.cacheCoeffects;
  if (definitions !== undefined && !Array.isArray(definitions)) {
    throw new TypeError(
      '[uklad-tanstack-query] attachQueryClient() cacheCoeffects must be an array.',
    );
  }
  for (const definition of definitions ?? []) {
    if (
      typeof definition !== 'object' ||
      definition === null ||
      typeof definition.id !== 'string' ||
      typeof definition.read !== 'function'
    ) {
      throw new TypeError(
        '[uklad-tanstack-query] Each cacheCoeffects entry must include an id and read function.',
      );
    }
  }
}

/** @internal Guard registration order without exposing a runtime bridge. */
export function assertAttachedQueryClient(queryClient: QueryClient): void {
  if (!attachedRuntimeByClient.has(queryClient)) {
    throw new Error(
      '[uklad-tanstack-query] No QueryClient is attached to an Uklad runtime. Call attachQueryClient(runtime, queryClient) before registering query subscriptions.',
    );
  }
}
