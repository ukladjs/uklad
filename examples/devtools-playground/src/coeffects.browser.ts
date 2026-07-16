import { regCoeffect } from "@flexsurfer/reflex";

// Browser coeffect adapters: read real browser state into the event's
// coeffects. coeffects.headless.ts registers the same ids against the
// in-memory environment.

regCoeffect('local-storage-get', (cofx, key: string) => {
  cofx.localStorageValue = window.localStorage.getItem(key);
  return cofx;
});
