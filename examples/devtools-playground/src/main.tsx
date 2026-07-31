/**
 * Browser entry point — one execution owner, one runtime.
 *
 * Platform selection happens here and nowhere else: the shared feature modules
 * first, then exactly one effect module and one coeffect module for this
 * target. `headless.ts` installs the identical feature modules with the
 * headless pair instead.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';

import { enableMapSet } from '@flexsurfer/reflex/vanilla';
import { createReflexInspector } from '@flexsurfer/reflex/devtools';
import { enableDevtools } from '@flexsurfer/reflex-devtools';

import { ReflexProvider } from './app/reflex/bindings';
import { registerFeatureModules } from './app/reflex/register';
import { createPlaygroundRuntime } from './app/reflex/runtime';
import App from './app/ui/App';
import { registerWebCoeffects, webCoeffectModes } from './platform/web/coeffects';
import { registerWebEffects, webEffectModes } from './platform/web/effects';
import './index.css';

enableMapSet();

const browserRuntime = createPlaygroundRuntime({
  runtimeId: 'devtools-playground.browser',
  name: 'DevTools Playground (Browser)',
});

registerFeatureModules(browserRuntime);
browserRuntime.registerModule(registerWebEffects);
browserRuntime.registerModule(registerWebCoeffects);

enableDevtools(createReflexInspector(browserRuntime), {
  operations: true,
  runtime: 'browser',
  effectMode: 'real',
  effects: { ...webEffectModes, ...webCoeffectModes },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ReflexProvider runtime={browserRuntime}>
      <App />
    </ReflexProvider>
  </React.StrictMode>,
);
