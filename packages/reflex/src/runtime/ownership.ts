/**
 * Clone a value at a runtime ownership boundary.
 *
 * Modern browsers and Node provide `structuredClone`, but jsdom deliberately
 * does not. The fallback covers the data values Reflex accepts at its public
 * boundaries so test and older-browser runtimes retain the same isolation
 * contract instead of silently sharing mutable input.
 */
export function cloneStructuredValue<T>(value: T): T {
  try {
    // Prefer the portable implementation for ordinary application data. It
    // retains the input realm's Array/Object prototypes, which matters when a
    // Node test runner hosts browser values in a separate vm context.
    return cloneFallback(value, new WeakMap<object, unknown>());
  } catch (fallbackError) {
    if (typeof globalThis.structuredClone === 'function') {
      return globalThis.structuredClone(value);
    }
    throw fallbackError;
  }
}

function cloneFallback<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') {
      throw new TypeError('Value is not structured-cloneable.');
    }
    return value;
  }

  const existing = seen.get(value);
  if (existing !== undefined) return existing as T;

  if (value instanceof Date) {
    const Constructor = value.constructor as new (time: number) => Date;
    return new Constructor(value.getTime()) as T;
  }
  if (value instanceof RegExp) {
    const Constructor = value.constructor as new (source: string, flags: string) => RegExp;
    return new Constructor(value.source, value.flags) as T;
  }
  if (value instanceof ArrayBuffer) return value.slice(0) as T;
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      const Constructor = value.constructor as new (
        buffer: ArrayBufferLike,
        byteOffset: number,
        byteLength: number,
      ) => DataView;
      return new Constructor(
        cloneFallback(value.buffer, seen),
        value.byteOffset,
        value.byteLength,
      ) as T;
    }
    const constructor = value.constructor as { new (source: ArrayBufferView): ArrayBufferView };
    return new constructor(value) as T;
  }
  if (value instanceof Map) {
    const Constructor = value.constructor as new () => Map<unknown, unknown>;
    const copy = new Constructor();
    seen.set(value, copy);
    for (const [key, entry] of value) {
      copy.set(cloneFallback(key, seen), cloneFallback(entry, seen));
    }
    return copy as T;
  }
  if (value instanceof Set) {
    const Constructor = value.constructor as new () => Set<unknown>;
    const copy = new Constructor();
    seen.set(value, copy);
    for (const entry of value) copy.add(cloneFallback(entry, seen));
    return copy as T;
  }
  if (Array.isArray(value)) {
    const Constructor = value.constructor as new () => unknown[];
    const copy: unknown[] = new Constructor();
    seen.set(value, copy);
    for (const entry of value) copy.push(cloneFallback(entry, seen));
    return copy as T;
  }

  const prototype = Object.getPrototypeOf(value);
  const isPlainObject =
    prototype === null ||
    prototype === Object.prototype ||
    (Object.getPrototypeOf(prototype) === null &&
      (prototype as { constructor?: { name?: unknown } }).constructor?.name === 'Object');
  if (!isPlainObject) {
    throw new TypeError('Value is not structured-cloneable.');
  }
  const copy: Record<string, unknown> = Object.create(prototype) as Record<string, unknown>;
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = cloneFallback((value as Record<string, unknown>)[key], seen);
  }
  return copy as T;
}
