import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import type { AppContracts } from '../../app/uklad/contracts';
import { registerTodosEvents } from './events';
import { registerTodosSubscriptions } from './subscriptions';

/**
 * The `todos` feature installer.
 *
 * It does not create a runtime, a state domain, a contract scope, or a graph
 * boundary — it only groups this feature's registrations so they can be
 * installed and disposed together. Platform effects and coeffects are
 * deliberately absent: those are selected by the entry point.
 */
export const todosModule: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registerTodosEvents(registrar);
  registerTodosSubscriptions(registrar);
};
