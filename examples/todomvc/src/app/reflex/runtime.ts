// Import from the subpath entrypoints: each entrypoint emits its own copy of
// the runtime types, so a runtime created through the package root cannot be
// inferred by packages (such as reflex-persist) that type against `/vanilla`.
import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';
import type { ReflexRuntime } from '@flexsurfer/reflex/vanilla';

import type { AppContracts } from './contracts';
import { createAppState } from './initial-state';

export interface CreateAppRuntimeOptions {
  runtimeId?: string;
  name?: string;
}

/**
 * Create one runtime for one execution owner.
 *
 * A factory rather than a module-level singleton: the browser entry point owns
 * exactly one, and each test owns an isolated one instead of resetting shared
 * process-global state.
 */
export function createAppRuntime(
  options: CreateAppRuntimeOptions = {},
): ReflexRuntime<AppContracts> {
  return createReflexRuntime<AppContracts>({
    initialState: createAppState(),
    runtimeId: options.runtimeId ?? 'todomvc',
    name: options.name ?? 'TodoMVC',
  });
}
