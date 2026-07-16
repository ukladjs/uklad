import { regEffect } from "@flexsurfer/reflex";
import { memoryStorage } from "./headless-env";

// Headless adapters: same effect ids as effects.browser.ts, safe by
// default — browser state becomes an in-memory map, pure UI affordances
// become no-ops. dispatch_event still reports the emitted effect contract
// either way, so an agent can verify "the handler emitted the right
// effect" without a browser.

// Reported through enableDevtools -> app_status so agents can see which
// effects really execute, which are memory-backed, and which are no-ops.
export const effectModes = {
  'local-storage-set': 'memory',
  'set-document-title': 'noop',
} as const;

regEffect('local-storage-set', ({ key, value }: { key: string; value: unknown }) => {
  memoryStorage.set(key, JSON.stringify(value));
});

regEffect('set-document-title', () => {
  // no-op: there is no document; the emitted effect is still observable
});
