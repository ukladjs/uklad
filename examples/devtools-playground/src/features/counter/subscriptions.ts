import type { ReflexModule, ReflexRegistrar } from '@flexsurfer/reflex/vanilla';

import { appIds, stateKeys } from '../../app/reflex/catalog';
import type { AppContracts } from '../../app/reflex/contracts';

export const registerCounterSubscriptions: ReflexModule<ReflexRegistrar<AppContracts>> = (
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
