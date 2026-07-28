/**
 * The development-only guard that reports an Immer draft left inside a
 * returned effect.
 *
 * A leaked draft is already revoked by the time effects are inspected, so the
 * guard must detect it without touching it in any way that throws — including
 * while building its own warning message.
 */
import { containsDraft } from '../../src/core/immer';
import { produce, enableMapSet } from 'immer';

enableMapSet();

/** Return a revoked draft of `base`, as an effect payload would capture one. */
function leakDraft<T extends object>(base: T, pick: (draft: any) => unknown): unknown {
  let leaked: unknown;
  produce(base, (draft: any) => {
    leaked = pick(draft);
    draft.__touched = true;
  });
  return leaked;
}

describe('containsDraft', () => {
  it('detects a draft returned directly as an effect payload', () => {
    const leaked = leakDraft({ todos: [{ id: 1 }] }, (draft) => draft.todos);
    expect(containsDraft([['storage/set', leaked]])).toBe(true);
  });

  it('detects a draft nested inside a plain payload object', () => {
    const leaked = leakDraft({ todos: [{ id: 1 }] }, (draft) => draft.todos[0]);
    expect(containsDraft([['storage/set', { first: leaked }]])).toBe(true);
  });

  it('detects a draft nested inside an array payload', () => {
    const leaked = leakDraft({ todos: [{ id: 1 }] }, (draft) => draft.todos[0]);
    expect(containsDraft([['storage/set', [0, [leaked]]]])).toBe(true);
  });

  it('detects a draft held in a Map or a Set', () => {
    const leaked = leakDraft({ todos: [{ id: 1 }] }, (draft) => draft.todos[0]);
    expect(containsDraft([['fx', new Map([['k', leaked]])]])).toBe(true);
    expect(containsDraft([['fx', new Set([leaked])]])).toBe(true);
  });

  it('accepts a plain snapshot taken from the draft', () => {
    const snapshot = produce({ todos: [{ id: 1 }] }, (draft: any) => {
      draft.todos.push({ id: 2 });
    }).todos;
    expect(containsDraft([['storage/set', snapshot]])).toBe(false);
  });

  it('accepts ordinary effect payloads', () => {
    expect(containsDraft([])).toBe(false);
    expect(containsDraft([['ui/scroll-top']])).toBe(false);
    expect(containsDraft([['fx', { a: 1, b: 'two', c: [1, 2, 3], d: null }]])).toBe(false);
  });

  it('does not report values that merely resist JSON serialization', () => {
    // The previous guard used JSON.stringify, so these reported a Proxy that
    // was never there.
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    expect(containsDraft([['fx', circular]])).toBe(false);
    expect(containsDraft([['fx', { big: BigInt(9) }]])).toBe(false);
    expect(containsDraft([['fx', { when: new Date(0), re: /x/g }]])).toBe(false);
  });

  it('terminates on a cyclic payload instead of scanning forever', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { a };
    a.b = b;
    expect(containsDraft([['fx', a]])).toBe(false);
  });

  it('still finds a shallow draft behind a large sibling collection', () => {
    // The scan is breadth-first for exactly this shape: a depth-first walk
    // would spend its whole budget inside `rows` and never reach `current`.
    const leaked = leakDraft({ todos: [{ id: 1 }] }, (draft) => draft.todos[0]);
    const rows = Array.from({ length: 10_000 }, (_, index) => ({ id: index }));
    expect(containsDraft([['storage/set', { rows, current: leaked }]])).toBe(true);
  });

  it('finds a draft in a later effect of a long effect list', () => {
    const leaked = leakDraft({ todos: [{ id: 1 }] }, (draft) => draft.todos);
    const effects: unknown[] = Array.from({ length: 40 }, (_, index) => ['fx/noop', index]);
    effects.push(['storage/set', leaked]);
    expect(containsDraft(effects)).toBe(true);
  });

  it('stays bounded on a large payload', () => {
    const rows = Array.from({ length: 50_000 }, (_, index) => ({
      id: index,
      name: `row ${index}`,
    }));
    const started = Date.now();
    expect(containsDraft([['storage/set', rows]])).toBe(false);
    // The unbounded JSON.stringify this replaced took milliseconds here.
    expect(Date.now() - started).toBeLessThan(50);
  });
});
