import type { ReflexModule, ReflexRegistrar } from '@flexsurfer/reflex/vanilla';

import type { AppContracts } from '../../app/reflex/contracts';
import { registerDiagnosticsEvents } from './events';

/**
 * `diagnostics` registers events only. A feature does not have to own every
 * file kind — the directory is stable whether or not it grows subscriptions.
 */
export const diagnosticsModule: ReflexModule<ReflexRegistrar<AppContracts>> = (registrar) => {
  registerDiagnosticsEvents(registrar);
};
