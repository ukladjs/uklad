import type { QueryClient } from '@tanstack/query-core';
import type { UkladContracts, UkladDisposer, UkladRuntime } from '@ukladjs/core/vanilla';

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

  return runtime.registerModule(() => {
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

/** @internal Guard registration order without exposing a runtime bridge. */
export function assertAttachedQueryClient(queryClient: QueryClient): void {
  if (!attachedRuntimeByClient.has(queryClient)) {
    throw new Error(
      '[uklad-tanstack-query] No QueryClient is attached to an Uklad runtime. Call attachQueryClient(runtime, queryClient) before registering query subscriptions.',
    );
  }
}
