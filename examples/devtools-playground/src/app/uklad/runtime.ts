import { createUkladRuntime } from '@ukladjs/core/vanilla';
import type { UkladRuntime } from '@ukladjs/core/vanilla';

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
): UkladRuntime<AppContracts> {
  return createUkladRuntime<AppContracts>({
    initialState: createInitialState(),
    runtimeId: options.runtimeId,
    name: options.name,
  });
}
