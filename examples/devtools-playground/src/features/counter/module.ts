import type { ReflexModule, ReflexRegistrar } from '@flexsurfer/reflex/vanilla';

import type { AppContracts } from '../../app/reflex/contracts';
import { registerCounterEvents } from './events';
import { registerCounterSubscriptions } from './subscriptions';

export const counterModule: ReflexModule<ReflexRegistrar<AppContracts>> = (registrar) => {
  registerCounterEvents(registrar);
  registerCounterSubscriptions(registrar);
};
