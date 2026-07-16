import { regEffect } from "@flexsurfer/reflex";

// Browser adapters: real side effects against real browser APIs.
// effects.headless.ts registers the same effect ids with Node-safe
// adapters, so event handlers emit the same effect contract in both
// runtimes and never know which one they run in.

regEffect('local-storage-set', ({ key, value }: { key: string; value: unknown }) => {
  window.localStorage.setItem(key, JSON.stringify(value));
});

regEffect('set-document-title', (title: string) => {
  document.title = title;
});
