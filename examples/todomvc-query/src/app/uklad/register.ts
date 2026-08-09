import { setupSubsHotReload } from '@ukladjs/core/react';
import type { UkladDisposer, UkladRuntime } from '@ukladjs/core/vanilla';

import { todosModule } from '../../features/todos/module';
import { appIds } from './catalog';
import type { AppContracts } from './contracts';

const featureModules = [todosModule];

let installed: { readonly runtime: UkladRuntime<AppContracts>; readonly dispose: UkladDisposer } | undefined;

/** Install every platform-independent feature module on one shared runtime. */
export function registerFeatureModules(runtime: UkladRuntime<AppContracts>): UkladDisposer {
  const disposers = featureModules.map((module) => runtime.registerModule(module));
  const dispose = () => {
    for (const disposeModule of disposers.reverse()) disposeModule();
  };

  installed = { runtime, dispose };
  return dispose;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (!installed) return;
    installed.dispose();
    setupSubsHotReload(installed.runtime, Object.values(appIds.subscriptions)).dispose();
  });

  import.meta.hot.accept((newModule) => {
    if (!newModule || !installed) return;
    const next = newModule as unknown as {
      registerFeatureModules: typeof registerFeatureModules;
    };
    next.registerFeatureModules(installed.runtime);
    setupSubsHotReload(installed.runtime).accept(newModule);
  });
}
