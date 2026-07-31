import type { ReflexModule, ReflexRegistrar } from '@flexsurfer/reflex/vanilla';

import type { AppContracts } from '../../app/reflex/contracts';
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
export const todosModule: ReflexModule<ReflexRegistrar<AppContracts>> = (registrar) => {
  registerTodosEvents(registrar);
  registerTodosSubscriptions(registrar);
};
