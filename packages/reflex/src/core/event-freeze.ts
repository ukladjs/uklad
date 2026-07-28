import { IS_DEV } from './environment';

/**
 * Enforce the immutable-event contract in development.
 *
 * A dispatched event and its payload belong to the runtime from the moment
 * `dispatch` is called: the event is executed on a later task, so a caller that
 * keeps mutating the value it dispatched changes what the handler eventually
 * sees. The runtime used to defend against that by deep-copying every event,
 * which cost time and memory on every dispatch to protect against a mistake
 * almost no application makes.
 *
 * Freezing instead turns the same mistake into an immediate `TypeError` at the
 * mutation site — module code is strict, so a write to a frozen object throws —
 * while production pays nothing at all.
 *
 * `Map` and `Set` entries cannot be protected this way, since `Object.freeze`
 * does not prevent `set`/`add`/`delete`. Their contents are still frozen, so a
 * mutation one level deeper is caught.
 */
export function freezeDispatchedEvent<T>(event: T): T {
  if (!IS_DEV) return event;
  freezeDeep(event, new Set());
  return event;
}

function freezeDeep(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (value instanceof Map) {
    for (const entry of value.values()) freezeDeep(entry, seen);
    return;
  }
  if (value instanceof Set) {
    for (const entry of value) freezeDeep(entry, seen);
    return;
  }

  Object.freeze(value);

  if (Array.isArray(value)) {
    for (const entry of value) freezeDeep(entry, seen);
    return;
  }
  for (const key of Object.keys(value)) {
    freezeDeep((value as Record<string, unknown>)[key], seen);
  }
}
