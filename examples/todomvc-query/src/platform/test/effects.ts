import type { QueryClient } from '@ukladjs/tanstack-query';
import type { UkladDisposer, UkladRuntime } from '@ukladjs/core/vanilla';

import type { AppContracts } from '../../app/uklad/contracts';
import { installWebEffects } from '../web/effects';
import type { TodosApi } from '../web/todos-api';

/** The test target uses the same Query bridge with an injected in-memory API. */
export function installTestEffects(
  runtime: UkladRuntime<AppContracts>,
  queryClient: QueryClient,
  api: TodosApi,
): UkladDisposer {
  return installWebEffects(runtime, queryClient, api);
}
