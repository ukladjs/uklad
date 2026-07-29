import { createReflexHooks } from '@flexsurfer/reflex/react';

import type { PlaygroundContracts } from './state';

/**
 * React bindings pre-bound to this app's contract.
 *
 * Components import these instead of the package hooks so subscription ids,
 * parameters, results, and dispatch payloads are all checked at the call site
 * without repeating a generic argument each time.
 *
 * The provider comes from the same call as the hooks, which is what ties the
 * two together: only a `ReflexRuntime<PlaygroundContracts>` satisfies it, so
 * the contract these hooks are checked against is the one the runtime beneath
 * them was actually built for.
 */
export const {
  ReflexProvider,
  useSubscription,
  useRuntime: usePlaygroundRuntime,
} = createReflexHooks<PlaygroundContracts>();
