import { createUkladRuntime } from '@ukladjs/core/vanilla';
import type { UkladRuntime } from '@ukladjs/core/vanilla';

import type { AppContracts } from './contracts';
import { createAppState } from './initial-state';

export function createAppRuntime(): UkladRuntime<AppContracts> {
  return createUkladRuntime<AppContracts>({
    initialState: createAppState(),
    runtimeId: 'todomvc-query',
    name: 'TodoMVC Query',
  });
}
