import type { ReflexModule, ReflexRegistrar } from '@flexsurfer/reflex/vanilla';

import type { AppContracts } from '../../app/reflex/contracts';
import { registerCollectionsEvents } from './events';
import { registerCollectionsSubscriptions } from './subscriptions';

export const collectionsModule: ReflexModule<ReflexRegistrar<AppContracts>> = (registrar) => {
  registerCollectionsEvents(registrar);
  registerCollectionsSubscriptions(registrar);
};
