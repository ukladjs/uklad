import type { ReflexModule, ReflexRegistrar } from '@flexsurfer/reflex/vanilla';

import type { AppContracts } from '../../app/reflex/contracts';
import { registerUsersEvents } from './events';
import { registerUsersSubscriptions } from './subscriptions';

export const usersModule: ReflexModule<ReflexRegistrar<AppContracts>> = (registrar) => {
  registerUsersEvents(registrar);
  registerUsersSubscriptions(registrar);
};
