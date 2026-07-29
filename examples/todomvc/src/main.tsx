import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { enableMapSet } from '@flexsurfer/reflex/vanilla';
import { HotReloadWrapper } from '@flexsurfer/reflex/react';

import TodoApp from './views';

import './index.css';

// These side-effect imports must finish before hydration is dispatched.
import './events';
import './subs';
import { persistence } from './storage';
import { ReflexProvider, todoRuntime } from './runtime';

// Immer requires an explicit plugin before it can draft the Map-backed todo collection.
enableMapSet();
if (import.meta.env.DEV) {
  void import('@flexsurfer/reflex-devtools').then(({ enableDevtools }) => {
    void import('@flexsurfer/reflex/devtools').then(({ createReflexInspector }) => {
      enableDevtools(createReflexInspector(todoRuntime));
    });
  });
}

// Synchronous for localStorage: todos are in state before the first render.
persistence.hydrate();
void persistence.whenHydrated().catch(() => {
  const warning = document.createElement('aside');
  warning.setAttribute('role', 'alert');
  warning.textContent = 'Saved todos could not be loaded. Persistence is paused. ';

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Clear saved data and continue';
  reset.addEventListener('click', () => {
    reset.disabled = true;
    void persistence.purge().then(
      () => warning.remove(),
      () => {
        reset.disabled = false;
        warning.firstChild!.textContent = 'Saved data could not be cleared. Try again. ';
      },
    );
  });
  warning.append(reset);
  document.body.prepend(warning);
});

const USE_STRICT_MODE = true;
const app = (
  // HotReloadWrapper forces a remount when subscriptions are hot reloaded.
  <ReflexProvider runtime={todoRuntime}>
    <HotReloadWrapper>
      <TodoApp />
    </HotReloadWrapper>
  </ReflexProvider>
);

createRoot(document.getElementById('root')!).render(
  USE_STRICT_MODE ? <StrictMode>{app}</StrictMode> : app,
);
