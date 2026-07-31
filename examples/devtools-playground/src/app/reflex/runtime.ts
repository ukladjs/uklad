import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';
import type { ReflexRuntime } from '@flexsurfer/reflex/vanilla';

import type { AppContracts } from './contracts';
import { createInitialState } from './initial-state';

export interface CreatePlaygroundRuntimeOptions {
  runtimeId: string;
  name: string;
}

/**
 * Create one runtime for one execution owner.
 *
 * This app has two: the browser entry point and the headless entry point. They
 * are separate execution owners with separate state and lifecycle, which is
 * exactly when a second runtime is warranted — a feature never is.
 */
export function createPlaygroundRuntime(
  options: CreatePlaygroundRuntimeOptions,
): ReflexRuntime<AppContracts> {
  return createReflexRuntime<AppContracts>({
    initialState: createInitialState(),
    runtimeId: options.runtimeId,
    name: options.name,
  });
}
