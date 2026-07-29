import React from 'react';
import ReactDOM from 'react-dom/client';
import { createReflexRuntime, enableMapSet } from '@flexsurfer/reflex/vanilla';
import { createReflexInspector } from '@flexsurfer/reflex/devtools';
import { enableDevtools } from '@flexsurfer/reflex-devtools';
import './index.css';
import App from './App';
import { ReflexProvider } from './hooks';
import { coeffectModes, installBrowserCoeffects } from './coeffects.browser';
import { createInitialState, type PlaygroundContracts } from './state';
import { effectModes, installBrowserEffects } from './effects.browser';
import { installPlaygroundEvents } from './events';
import { installPlaygroundSubscriptions } from './subs';

enableMapSet();

const browserRuntime = createReflexRuntime<PlaygroundContracts>({
  initialState: createInitialState(),
  runtimeId: 'devtools-playground.browser',
  name: 'DevTools Playground (Browser)',
});

browserRuntime.registerModule(installPlaygroundEvents);
browserRuntime.registerModule(installPlaygroundSubscriptions);
browserRuntime.registerModule(installBrowserEffects);
browserRuntime.registerModule(installBrowserCoeffects);

enableDevtools(createReflexInspector(browserRuntime), {
  operations: true,
  runtime: 'browser',
  effectMode: 'real',
  effects: {
    ...effectModes,
    ...coeffectModes,
    'fake-effect': 'real',
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ReflexProvider runtime={browserRuntime}>
      <App />
    </ReflexProvider>
  </React.StrictMode>,
);
