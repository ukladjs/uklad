import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import type { AppContracts } from '../../app/uklad/contracts';
import { registerTodosEvents } from './events';
import { registerTodosSubscriptions } from './subscriptions';

/** Groups only the Todo feature's platform-independent registrations. */
export const todosModule: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registerTodosEvents(registrar);
  registerTodosSubscriptions(registrar);
};
