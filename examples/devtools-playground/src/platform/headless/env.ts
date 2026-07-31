// Shared in-memory stand-ins for browser APIs, used by the headless effect and
// coeffect adapters in this directory. State lives for the lifetime of the
// headless process — it persists between dispatches, is gone on restart, and
// never touches the real environment.

export const memoryStorage = new Map<string, string>();
