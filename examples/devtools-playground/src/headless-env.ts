// Shared in-memory stand-ins for browser APIs, used by the headless
// effect/coeffect adapters (effects.headless.ts / coeffects.headless.ts).
// State lives for the lifetime of the headless process — persists between
// dispatches, gone on restart, never touches the real environment.

export const memoryStorage = new Map<string, string>();
