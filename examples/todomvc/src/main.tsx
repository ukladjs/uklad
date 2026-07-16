import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  createReflexInspector,
  dispatch,
  enableMapSet,
  HotReloadWrapper,
} from '@flexsurfer/reflex';
import { enableDevtools } from '@flexsurfer/reflex-devtools';

import { EVENT_IDS } from './event-ids';
import TodoApp from './views';

import './index.css';

// These side-effect imports must finish before the startup event is dispatched.
import './db';
import './events';
import './subs';
import './storage';

// Immer requires an explicit plugin before it can draft the Map-backed todo collection.
enableMapSet();
enableDevtools(createReflexInspector());

dispatch([EVENT_IDS.INIT_APP]);

const USE_STRICT_MODE = false;
const app = (
  // HotReloadWrapper forces a remount when subscriptions are hot reloaded.
  <HotReloadWrapper>
    <TodoApp />
  </HotReloadWrapper>
);

createRoot(document.getElementById('root')!).render(
  USE_STRICT_MODE ? <StrictMode>{app}</StrictMode> : app,
);
