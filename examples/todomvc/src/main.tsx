import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './db';
import TodoApp from './views';
import './events';
import './subs';
import './storage';
import { dispatch, enableTracing, enableTracePrint, HotReloadWrapper } from '@lib/index';
import { enableMapSet } from 'immer';
import { EVENT_IDS } from './event-ids';
import { enableDevtools } from '@flexsurfer/reflex-devtools';

// todos field in appDb is a Map, so we need to enable it explicitly for immer
enableMapSet();
// Enable tracing and trace printing in console for debugging
//enableTracing();
//enableTracePrint();
//enableDevtools();

// Initialize the app
dispatch([EVENT_IDS.INIT_APP]);

const useStrictMode = false;
const app = (
  // HotReloadWrapper forces a remount when subscriptions are hot reloaded.
  <HotReloadWrapper>
    <TodoApp />
  </HotReloadWrapper>
);

createRoot(document.getElementById('root')!).render(
  useStrictMode ? <StrictMode>{app}</StrictMode> : app,
);
