import { createUkladRuntime, type UkladContracts, type UkladRegistrar } from '@ukladjs/core';

import { createDevtoolsState } from './state';

/** The dashboard owns one explicit Uklad runtime for its UI state. */
export const devtoolsRuntime = createUkladRuntime({
  initialState: createDevtoolsState(),
  runtimeId: 'uklad-devtools-ui',
  name: 'Uklad DevTools UI',
});

type DevtoolsContracts = UkladContracts & {
  state: Record<string, any>;
  events: Record<string, readonly any[]>;
  effects: Record<string, any>;
  subscriptions: Record<string, { readonly params: readonly any[]; readonly result: any }>;
};

let registrar: UkladRegistrar<DevtoolsContracts> | undefined;
devtoolsRuntime.registerModule((nextRegistrar) => {
  registrar = nextRegistrar as unknown as UkladRegistrar<DevtoolsContracts>;
});

export const dispatch = devtoolsRuntime.dispatch.bind(devtoolsRuntime);
export const regEvent = (...args: Parameters<UkladRegistrar<DevtoolsContracts>['regEvent']>) =>
  registrar!.regEvent(...args);
export const regEffect = (...args: Parameters<UkladRegistrar<DevtoolsContracts>['regEffect']>) =>
  registrar!.regEffect(...args);
export const regRootSub = (...args: Parameters<UkladRegistrar<DevtoolsContracts>['regRootSub']>) =>
  registrar!.regRootSub(...args);
export const regSub = (...args: Parameters<UkladRegistrar<DevtoolsContracts>['regSub']>) =>
  registrar!.regSub(...args);
