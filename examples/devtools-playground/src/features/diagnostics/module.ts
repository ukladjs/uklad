import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import type { AppContracts } from '../../app/uklad/contracts';
import { registerDiagnosticsEvents } from './events';

/**
 * `diagnostics` registers events only. A feature does not have to own every
 * file kind — the directory is stable whether or not it grows subscriptions.
 */
export const diagnosticsModule: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registerDiagnosticsEvents(registrar);
};
