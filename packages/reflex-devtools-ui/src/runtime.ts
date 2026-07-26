import { createReflexRuntime } from '@flexsurfer/reflex';

import { createDevtoolsState } from './state';

/** The dashboard owns one explicit Reflex runtime for its UI state. */
export const devtoolsRuntime = createReflexRuntime({
  initialState: createDevtoolsState(),
  runtimeId: 'reflex-devtools-ui',
  name: 'Reflex DevTools UI',
});

export const dispatch = devtoolsRuntime.dispatch.bind(devtoolsRuntime);
export const regEvent = devtoolsRuntime.regEvent.bind(devtoolsRuntime);
export const regEffect = devtoolsRuntime.regEffect.bind(devtoolsRuntime);
export const regRootSub = devtoolsRuntime.regRootSub.bind(devtoolsRuntime);
export const regSub = devtoolsRuntime.regSub.bind(devtoolsRuntime);
