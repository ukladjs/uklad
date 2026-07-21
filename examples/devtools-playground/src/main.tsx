import React from 'react';
import ReactDOM from 'react-dom/client';
import { createReflexRuntime, enableMapSet } from '@flexsurfer/reflex/vanilla';
import { ReflexProvider } from '@flexsurfer/reflex/react';
import { enableDevtools } from '@flexsurfer/reflex-devtools';
import { createOperationInspector } from '@flexsurfer/reflex-operations';
import './index.css';
import App from './App';
import { coeffectModes, installBrowserCoeffects } from './coeffects.browser';
import { createInitialAppDb, type PlaygroundContracts } from './db';
import { effectModes, installBrowserEffects } from './effects.browser';
import { installPlaygroundEvents } from './events';
import { installPlaygroundSubscriptions } from './subs';

enableMapSet();

const browserRuntime = createReflexRuntime<PlaygroundContracts>({
  initialDb: createInitialAppDb(),
  runtimeId: 'devtools-playground.browser',
  name: 'DevTools Playground (Browser)',
});

browserRuntime.registerModule(installPlaygroundEvents);
browserRuntime.registerModule(installPlaygroundSubscriptions);
browserRuntime.registerModule(installBrowserEffects);
browserRuntime.registerModule(installBrowserCoeffects);

enableDevtools(createOperationInspector(browserRuntime), {
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
