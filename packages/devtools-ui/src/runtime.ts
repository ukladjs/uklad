import { createReflexRuntime, type ReflexContracts, type ReflexRegistrar } from '@flexsurfer/reflex';

import { createDevtoolsState } from './state';

/** The dashboard owns one explicit Reflex runtime for its UI state. */
export const devtoolsRuntime = createReflexRuntime({
  initialState: createDevtoolsState(),
  runtimeId: 'reflex-devtools-ui',
  name: 'Reflex DevTools UI',
});

type DevtoolsContracts = ReflexContracts & {
  state: Record<string, any>;
  events: Record<string, readonly any[]>;
  effects: Record<string, any>;
  subscriptions: Record<string, { readonly params: readonly any[]; readonly result: any }>;
};

let registrar: ReflexRegistrar<DevtoolsContracts> | undefined;
devtoolsRuntime.registerModule((nextRegistrar) => {
  registrar = nextRegistrar as unknown as ReflexRegistrar<DevtoolsContracts>;
});

export const dispatch = devtoolsRuntime.dispatch.bind(devtoolsRuntime);
export const regEvent = (...args: Parameters<ReflexRegistrar<DevtoolsContracts>['regEvent']>) =>
  registrar!.regEvent(...args);
export const regEffect = (...args: Parameters<ReflexRegistrar<DevtoolsContracts>['regEffect']>) =>
  registrar!.regEffect(...args);
export const regRootSub = (...args: Parameters<ReflexRegistrar<DevtoolsContracts>['regRootSub']>) =>
  registrar!.regRootSub(...args);
export const regSub = (...args: Parameters<ReflexRegistrar<DevtoolsContracts>['regSub']>) =>
  registrar!.regSub(...args);
