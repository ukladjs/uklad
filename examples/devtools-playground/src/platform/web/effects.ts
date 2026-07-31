import type { ReflexModule, ReflexRegistrar } from '@flexsurfer/reflex/vanilla';

import { appIds } from '../../app/reflex/catalog';
import type { AppContracts } from '../../app/reflex/contracts';

/**
 * Web implementations of the application's effect ids: real side effects
 * against real browser APIs.
 *
 * `platform/headless/effects.ts` registers the same ids with Node-safe
 * adapters, so event handlers emit the same effect contract in both runtimes
 * and never know which one they run in.
 */

/**
 * Adapter mode per effect id, reported through `enableDevtools` to
 * `app_status` so an agent can see which effects really execute.
 */
export const webEffectModes = {
  [appIds.effects.diagnosticsDispatchEvent]: 'real',
  [appIds.effects.diagnosticsSink]: 'real',
  [appIds.effects.storageLocalSet]: 'real',
  [appIds.effects.documentTitle]: 'real',
} as const;

export const registerWebEffects: ReflexModule<ReflexRegistrar<AppContracts>> = (registrar) => {
  registrar.regEffect(appIds.effects.diagnosticsDispatchEvent, (event, runtime) => {
    runtime.dispatch(event);
  });

  registrar.regEffect(appIds.effects.diagnosticsSink, (payload) => {
    console.log(appIds.effects.diagnosticsSink, payload);
  });

  registrar.regEffect(appIds.effects.storageLocalSet, ({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  });

  registrar.regEffect(appIds.effects.documentTitle, (title) => {
    document.title = title;
  });
};
