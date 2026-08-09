import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { HotReloadWrapper } from '@ukladjs/core/react';
import { UkladProvider } from './app/uklad/bindings';
import { registerFeatureModules } from './app/uklad/register';
import { createAppRuntime } from './app/uklad/runtime';
import { TodoApp } from './features/todos/ui/TodoApp';
import { createWebQueryClient, installWebEffects } from './platform/web/effects';
import { todosApi } from './platform/web/todos-api';

import './index.css';

const appRuntime = createAppRuntime();
registerFeatureModules(appRuntime);
const queryClient = createWebQueryClient();
const disposeWebEffects = installWebEffects(appRuntime, queryClient, todosApi);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeWebEffects();
    queryClient.clear();
  });
}

if (import.meta.env.DEV) {
  const serverUrl = import.meta.env.VITE_UKLAD_DEVTOOLS_SERVER_URL || undefined;
  void import('@ukladjs/devtools').then(({ enableDevtools }) => {
    void import('@ukladjs/core/devtools').then(({ createUkladInspector }) => {
      enableDevtools(
        createUkladInspector(appRuntime),
        serverUrl === undefined ? undefined : { serverUrl },
      );
    });
  });
}

const app = (
  <UkladProvider runtime={appRuntime}>
    <HotReloadWrapper>
      <TodoApp />
    </HotReloadWrapper>
  </UkladProvider>
);

createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
