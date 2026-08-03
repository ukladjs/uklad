import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';
import { memoryStorage } from './env';

/**
 * Headless implementations of the same effect ids as `platform/web/effects.ts`,
 * safe by default: browser state becomes an in-memory map and a pure UI
 * affordance becomes a documented no-op.
 *
 * The emitted effect contract is unchanged, so an agent can verify "the handler
 * emitted the right effect" without a browser.
 */
export const headlessEffectModes = {
  [appIds.effects.diagnosticsDispatchEvent]: 'real',
  [appIds.effects.diagnosticsSink]: 'real',
  [appIds.effects.storageLocalSet]: 'memory',
  [appIds.effects.documentTitle]: 'noop',
} as const;

export const registerHeadlessEffects: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registrar.regEffect(appIds.effects.diagnosticsDispatchEvent, (event, runtime) => {
    runtime.dispatch(event);
  });

  registrar.regEffect(appIds.effects.diagnosticsSink, (payload) => {
    console.log(appIds.effects.diagnosticsSink, payload);
  });

  registrar.regEffect(appIds.effects.storageLocalSet, ({ key, value }) => {
    memoryStorage.set(key, JSON.stringify(value));
  });

  registrar.regEffect(appIds.effects.documentTitle, () => {
    // Deliberate no-op: there is no document here. The effect is still emitted
    // and observable in the trace, so a missing handler is never mistaken for
    // success.
  });
};
