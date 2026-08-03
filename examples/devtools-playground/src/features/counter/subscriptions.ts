import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds, stateKeys } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

export const registerCounterSubscriptions: UkladModule<UkladRegistrar<AppContracts>> = (
  registrar,
) => {
  // `regRootSub` maps the queried subscription id to the state property that
  // backs it. Components know `counter/value`; only handlers know `counterValue`.
  registrar.regRootSub(appIds.subscriptions.counterValue, stateKeys.counterValue);
  registrar.regRootSub(
    appIds.subscriptions.counterEffectDispatches,
    stateKeys.counterEffectDispatches,
  );
};
