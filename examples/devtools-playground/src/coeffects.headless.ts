import type { ReflexRuntime } from '@flexsurfer/reflex/vanilla';
import type { PlaygroundContracts } from './state';
import { memoryStorage } from './headless-env';

// Headless coeffect adapters: same coeffect ids as coeffects.browser.ts,
// reading from the in-memory environment instead of the browser.

export const coeffectModes = {
  'local-storage-get': 'memory',
} as const;

export function installHeadlessCoeffects(runtime: ReflexRuntime<PlaygroundContracts>): void {
  runtime.regCoeffect('local-storage-get', (cofx, key: string) => {
    cofx.localStorageValue = memoryStorage.get(key) ?? null;
    return cofx;
  });
}
