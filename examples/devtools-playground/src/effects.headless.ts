import type { ReflexRegistrar } from '@flexsurfer/reflex/vanilla';
import type { PlaygroundContracts } from './state';
import { memoryStorage } from './headless-env';

// Headless adapters: same effect ids as effects.browser.ts, safe by
// default — browser state becomes an in-memory map, pure UI affordances
// become no-ops. dispatch_event still reports the emitted effect contract
// either way, so an agent can verify "the handler emitted the right
// effect" without a browser.

// Reported through enableDevtools -> app_status so agents can see which
// effects really execute, which are memory-backed, and which are no-ops.
export const effectModes = {
  'dispatch-event-effect': 'real',
  'local-storage-set': 'memory',
  'set-document-title': 'noop',
} as const;

export function installHeadlessEffects(registrar: ReflexRegistrar<PlaygroundContracts>): void {
  registrar.regEffect('dispatch-event-effect', (event, runtime) => {
    runtime.dispatch(event);
  });

  registrar.regEffect('fake-effect', (param) => {
    console.log('fake-effect', param);
  });
  
  registrar.regEffect('local-storage-set', ({ key, value }) => {
    memoryStorage.set(key, JSON.stringify(value));
  });

  registrar.regEffect('set-document-title', () => {
    // no-op: there is no document; the emitted effect is still observable
  });
}
