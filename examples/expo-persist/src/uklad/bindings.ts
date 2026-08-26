import { createUkladHooks } from '@ukladjs/core/react';

import type { AppContracts } from './uklad';

export const { UkladProvider, useRuntime, useSubscription } = createUkladHooks<AppContracts>();
