// Import from the subpath entrypoints: each entrypoint emits its own copy of
// the runtime types, so a runtime created through the package root cannot be
// inferred by packages (such as uklad-persist) that type against `/vanilla`.
import { createUkladRuntime } from '@ukladjs/core/vanilla';
import type { UkladRuntime } from '@ukladjs/core/vanilla';

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
): UkladRuntime<AppContracts> {
  return createUkladRuntime<AppContracts>({
    initialState: createAppState(),
    runtimeId: options.runtimeId ?? 'todomvc',
    name: options.name ?? 'TodoMVC',
  });
}
