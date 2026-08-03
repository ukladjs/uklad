import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import type { AppContracts } from '../../app/uklad/contracts';
import { registerCollectionsEvents } from './events';
import { registerCollectionsSubscriptions } from './subscriptions';

export const collectionsModule: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registerCollectionsEvents(registrar);
  registerCollectionsSubscriptions(registrar);
};
