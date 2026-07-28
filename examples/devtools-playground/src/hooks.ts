import { createReflexHooks, useReflexRuntime } from '@flexsurfer/reflex/react';

import type { PlaygroundContracts } from './state';

/**
 * React bindings pre-bound to this app's contract.
 *
 * Components import these instead of the package hooks so subscription ids,
 * parameters, results, and dispatch payloads are all checked at the call site
 * without repeating a generic argument each time.
 */
export const { useSubscription } = createReflexHooks<PlaygroundContracts>();

/** The nearest runtime, typed with the playground contract. */
export function usePlaygroundRuntime() {
  return useReflexRuntime<PlaygroundContracts>();
}
