import type { ReflexRegistrar } from '@flexsurfer/reflex/vanilla';
import type { PlaygroundContracts } from './state';

// Browser adapters: real side effects against real browser APIs.
// effects.headless.ts registers the same effect ids with Node-safe
// adapters, so event handlers emit the same effect contract in both
// runtimes and never know which one they run in.

export const effectModes = {
  'dispatch-event-effect': 'real',
  'local-storage-set': 'real',
  'set-document-title': 'real',
} as const;

export function installBrowserEffects(registrar: ReflexRegistrar<PlaygroundContracts>): void {
  registrar.regEffect('dispatch-event-effect', (event, runtime) => {
    runtime.dispatch(event);
  });

  registrar.regEffect('fake-effect', (param) => {
    console.log('fake-effect', param);
  });

  registrar.regEffect('local-storage-set', ({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  });

  registrar.regEffect('set-document-title', (title) => {
    document.title = title;
  });
}
