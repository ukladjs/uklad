import {
  Immer,
  current as immerCurrent,
  enableMapSet as immerEnableMapSet,
  enablePatches as immerEnablePatches,
  isDraft,
  original as immerOriginal,
  type Draft,
} from 'immer';
import type { produce as ImmerProduce, produceWithPatches as ImmerProduceWithPatches } from 'immer';

let patchesPluginEnabled = false;

/**
 * Uklad owns state through its event API, not through recursive runtime
 * freezes. Keep Immer's development and production paths alike: an event
 * commit must not walk the complete state graph solely to detect a later
 * authoring mistake.
 */
const runtimeImmer = new Immer({ autoFreeze: false });

/** Runtime-scoped producers that retain Immer drafts without auto-freezing results. */
export const produce: typeof ImmerProduce = runtimeImmer.produce;
export const produceWithPatches: typeof ImmerProduceWithPatches = runtimeImmer.produceWithPatches;

/** Return a draft's underlying base value, or pass a non-draft through unchanged. */
export function original<T>(value: T): T {
  return isDraft(value) ? (immerOriginal(value as Draft<T>)! as T) : value;
}

/** Return a non-draft snapshot of a draft's current state, or pass a non-draft through. */
export function current<T>(value: T): T {
  return isDraft(value) ? (immerCurrent(value as Draft<T>) as T) : value;
}

/** Enable Immer support for `Map` and `Set` values. */
export function enableMapSet(): void {
  immerEnableMapSet();
}

/**
 * Bound on the nodes one leaked-draft scan may visit.
 *
 * The scan is breadth-first, so the budget is spent on the shallowest nodes —
 * where a leaked draft actually appears (the payload itself, or a field of a
 * small wrapper). A deep or very wide payload is therefore only partially
 * examined, which trades an unlikely missed diagnostic for a cost that does
 * not scale with payload size on every development-mode event.
 */
const DRAFT_SCAN_NODE_BUDGET = 128;

/** Plain-object nesting `snapshotDrafts` will walk through to reach a draft. */
const DRAFT_SNAPSHOT_MAX_DEPTH = 3;

/** Replace a live draft with a plain snapshot, or return the value unchanged. */
function snapshotValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (isDraft(value)) return immerCurrent(value as Draft<unknown>);
  // Collections are never walked. Proving that a large array or Map holds no
  // draft costs far more than the mistake it would catch, and every event
  // would pay it. `containsDraft` covers those shapes as a development
  // diagnostic instead.
  if (depth >= DRAFT_SNAPSHOT_MAX_DEPTH || Array.isArray(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  let changed = false;
  const snapshot: Record<string, unknown> = {};
  for (const key in value as Record<string, unknown>) {
    const before = (value as Record<string, unknown>)[key];
    const after = snapshotValue(before, depth + 1);
    snapshot[key] = after;
    if (after !== before) changed = true;
  }
  return changed ? snapshot : value;
}

/**
 * @internal Replace drafts an event handler left in its returned effects.
 *
 * Must run inside the `produce` recipe, while the drafts are still live: once
 * `produce` returns they are revoked and the effect handler would receive a
 * dead value. This performs the `current()` call the handler should have made,
 * so the common shapes — a draft as the payload, or a draft on a field of a
 * small wrapper object — are correct without the author having to know the
 * rule. Effects are `[id, payload]` tuples, so the list and the tuples are
 * walked structurally rather than generically.
 */
export function snapshotDrafts(effects: unknown): unknown {
  if (!Array.isArray(effects)) return effects;

  let changed = false;
  const snapshot = new Array(effects.length);
  for (let index = 0; index < effects.length; index++) {
    const effect = effects[index];
    snapshot[index] = effect;
    if (!Array.isArray(effect) || effect.length < 2) continue;

    const payload = effect[1];
    const payloadSnapshot = snapshotValue(payload, 0);
    if (payloadSnapshot === payload) continue;

    const effectSnapshot = effect.slice();
    effectSnapshot[1] = payloadSnapshot;
    snapshot[index] = effectSnapshot;
    changed = true;
  }
  return changed ? snapshot : effects;
}

/**
 * @internal Report whether a value still holds an Immer draft.
 *
 * `produce` revokes its drafts as it returns, so touching a leaked one throws.
 * That is both how this finds them and why the probe is guarded: a throw is a
 * positive result, not a failure.
 *
 * This runs after `snapshotDrafts`, so it reports only the shapes that
 * deliberately went unconverted: drafts inside a collection, or nested deeper
 * than a few plain objects.
 */
export function containsDraft(value: unknown): boolean {
  // Breadth-first: a queue with a read cursor rather than a stack, so the
  // budget is spent nearest the payload root.
  const queue: unknown[] = [value];
  const seen = new Set<object>();
  let budget = DRAFT_SCAN_NODE_BUDGET;
  let cursor = 0;

  while (cursor < queue.length && budget > 0) {
    const node = queue[cursor++];
    if (node === null || typeof node !== 'object') continue;
    budget--;

    try {
      if (isDraft(node)) return true;
    } catch {
      // Only a revoked draft rejects this probe.
      return true;
    }

    if (seen.has(node)) continue;
    seen.add(node);

    // Enqueue no more than the scan can still visit. Without this, one wide
    // collection — a persisted row list, say — would cost a push per element
    // even though the budget stops the walk long before reaching them.
    let room = budget;
    if (room <= 0) break;

    if (Array.isArray(node)) {
      for (let index = 0; index < node.length && room > 0; index++, room--) {
        queue.push(node[index]);
      }
    } else if (node instanceof Map) {
      for (const [key, entry] of node) {
        if (room <= 0) break;
        queue.push(key);
        queue.push(entry);
        room -= 2;
      }
    } else if (node instanceof Set) {
      for (const entry of node) {
        if (room <= 0) break;
        queue.push(entry);
        room--;
      }
    } else {
      for (const key of Object.keys(node)) {
        if (room <= 0) break;
        queue.push((node as Record<string, unknown>)[key]);
        room--;
      }
    }
  }

  return false;
}

/** Idempotently enable Immer patch generation for event tracing. */
export function ensurePatchesEnabled(): void {
  if (patchesPluginEnabled) return;
  immerEnablePatches();
  patchesPluginEnabled = true;
}
