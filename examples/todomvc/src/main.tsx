import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { enableMapSet } from '@ukladjs/core/vanilla';
import { HotReloadWrapper } from '@ukladjs/core/react';

import { UkladProvider } from './app/uklad/bindings';
import { registerFeatureModules } from './app/uklad/register';
import { createAppRuntime } from './app/uklad/runtime';
import { TodoApp } from './features/todos/ui/TodoApp';
import { registerWebCoeffects } from './platform/web/coeffects';
import { registerWebPersistence } from './platform/web/persistence';

import './index.css';

// Immer requires an explicit plugin before it can draft the Map-backed todo root.
enableMapSet();

// The web entry point owns the application's single runtime, and it is the one
// place platform selection happens: shared feature modules first, then exactly
// the web adapters. A native, headless, or test entry point installs the same
// feature modules with a different platform pair.
const appRuntime = createAppRuntime();
registerFeatureModules(appRuntime);
appRuntime.registerModule(registerWebCoeffects);

const persistence = registerWebPersistence(appRuntime);

if (import.meta.hot) {
  import.meta.hot.dispose(() => persistence.dispose());
}

if (import.meta.env.DEV) {
  void import('@ukladjs/devtools').then(({ enableDevtools }) => {
    void import('@ukladjs/core/devtools').then(({ createUkladInspector }) => {
      enableDevtools(createUkladInspector(appRuntime));
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
  <UkladProvider runtime={appRuntime}>
    <HotReloadWrapper>
      <TodoApp />
    </HotReloadWrapper>
  </UkladProvider>
);

createRoot(document.getElementById('root')!).render(
  USE_STRICT_MODE ? <StrictMode>{app}</StrictMode> : app,
);
