import type { ReflexRegistrar } from '@flexsurfer/reflex/vanilla';
import type { PlaygroundContracts } from './state';

// Browser coeffect adapters: read real browser state into the event's
// coeffects. coeffects.headless.ts registers the same ids against the
// in-memory environment.

export const coeffectModes = {
  'local-storage-get': 'real',
} as const;

export function installBrowserCoeffects(registrar: ReflexRegistrar<PlaygroundContracts>): void {
  registrar.regCoeffect('local-storage-get', (cofx, key: string) => {
    cofx.localStorageValue = window.localStorage.getItem(key);
    return cofx;
  });
}
