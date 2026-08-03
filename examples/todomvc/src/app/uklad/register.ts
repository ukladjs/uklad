import { setupSubsHotReload } from '@ukladjs/core/react';
import type { UkladDisposer, UkladRuntime } from '@ukladjs/core/vanilla';

import { todosModule } from '../../features/todos/module';
import { appIds } from './catalog';
import type { AppContracts } from './contracts';

/** The platform-independent feature modules every runtime installs. */
const featureModules = [todosModule];

let installed: { runtime: UkladRuntime<AppContracts>; dispose: UkladDisposer } | undefined;

/**
 * Install the application's feature modules on one runtime.
 *
 * Each module is installed separately so features keep independent disposal
 * and hot-reload ownership; that is organizational, not runtime isolation —
 * they all share this runtime's state and reactive graph.
 */
export function registerFeatureModules(runtime: UkladRuntime<AppContracts>): UkladDisposer {
  const disposers = featureModules.map((module) => runtime.registerModule(module));
  const dispose = () => {
    for (const disposeModule of disposers.reverse()) disposeModule();
  };

  installed = { runtime, dispose };
  return dispose;
}

if (import.meta.hot) {
  // Feature files are reached only through this module, so Vite bubbles their
  // updates here. Remove exactly this app's registrations — a persistence
  // module attached to the same runtime stays installed — then reinstall the
  // replacement module's registrations on the same runtime.
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
