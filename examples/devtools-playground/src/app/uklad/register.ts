import type { UkladDisposer, UkladRuntime } from '@ukladjs/core/vanilla';

import { collectionsModule } from '../../features/collections/module';
import { counterModule } from '../../features/counter/module';
import { diagnosticsModule } from '../../features/diagnostics/module';
import { serverModule } from '../../features/server/module';
import { usersModule } from '../../features/users/module';
import type { AppContracts } from './contracts';

/** The platform-independent feature modules every entry point installs. */
const featureModules = [
  counterModule,
  usersModule,
  serverModule,
  collectionsModule,
  diagnosticsModule,
];

/**
 * Install the application's feature modules on one runtime.
 *
 * The browser and headless entry points call this with the identical module
 * list; only the platform effect and coeffect modules they add afterwards
 * differ. Each module is installed separately so features keep independent
 * disposal — that is organizational, not runtime isolation: they all share
 * this runtime's state and reactive graph.
 */
export function registerFeatureModules(runtime: UkladRuntime<AppContracts>): UkladDisposer {
  const disposers = featureModules.map((module) => runtime.registerModule(module));
  return () => {
    for (const disposeModule of disposers.reverse()) disposeModule();
  };
}
