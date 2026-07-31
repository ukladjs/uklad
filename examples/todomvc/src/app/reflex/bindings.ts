import { createReflexHooks } from '@flexsurfer/reflex/react';

import type { AppContracts } from './contracts';

/**
 * React bindings for this application's contract, created once.
 *
 * The provider ships with the hooks rather than coming from the package, which
 * is what makes the pairing checkable: it accepts only a runtime built for
 * `AppContracts`, so the hooks' inferred subscription results cannot drift
 * from the runtime that actually serves them. Views therefore need no inline
 * generics, and `useRuntime()` gives them a dispatch checked against the same
 * contract without importing a module-level runtime singleton.
 */
export const { ReflexProvider, useSubscription, useRuntime } = createReflexHooks<AppContracts>();
