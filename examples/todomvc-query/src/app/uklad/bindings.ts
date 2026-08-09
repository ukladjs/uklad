import { createUkladHooks } from '@ukladjs/core/react';

import type { AppContracts } from './contracts';

/** One typed hook set binds this view to its one typed Uklad runtime. */
export const { UkladProvider, useSubscription, useRuntime } = createUkladHooks<AppContracts>();
