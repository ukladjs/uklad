import type { EqualityCheckFn } from '../types';

const hasOwn = Object.prototype.hasOwnProperty;
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable;

interface TypedArrayView {
  readonly length: number;
  readonly [index: number]: number | bigint;
}

const typedArrayPrototypes = new Set<object>([
  Int8Array.prototype,
  Uint8Array.prototype,
  Uint8ClampedArray.prototype,
  Int16Array.prototype,
  Uint16Array.prototype,
  Int32Array.prototype,
  Uint32Array.prototype,
  Float32Array.prototype,
  Float64Array.prototype,
]);
if (typeof BigInt64Array !== 'undefined') typedArrayPrototypes.add(BigInt64Array.prototype);
if (typeof BigUint64Array !== 'undefined') typedArrayPrototypes.add(BigUint64Array.prototype);

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

function isPlainObjectPrototype(prototype: object | null): boolean {
  return prototype === Object.prototype || prototype === null;
}

function asTypedArray(value: object, prototype: object | null): TypedArrayView | undefined {
  if (!ArrayBuffer.isView(value)) return undefined;
  if (prototype === null || !typedArrayPrototypes.has(prototype)) return undefined;
  const view = value as unknown as TypedArrayView;
  return typeof view.length === 'number' ? view : undefined;
}

function shallowArrayEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index];
    if (!Object.is(leftValue, right[index])) return false;
    // Distinguish a hole from an explicit `undefined` without adding an own-key
    // lookup to the common dense-array path.
    if (leftValue === undefined && hasOwn.call(left, index) !== hasOwn.call(right, index)) {
      return false;
    }
  }
  return true;
}

function shallowMapEqual(
  left: ReadonlyMap<unknown, unknown>,
  right: ReadonlyMap<unknown, unknown>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (!right.has(key) || !Object.is(value, right.get(key))) return false;
  }
  return true;
}

function shallowSetEqual(left: ReadonlySet<unknown>, right: ReadonlySet<unknown>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function shallowTypedArrayEqual(left: TypedArrayView, right: TypedArrayView): boolean {
  if (
    Object.getPrototypeOf(left) !== Object.getPrototypeOf(right) ||
    left.length !== right.length
  ) {
    return false;
  }
  for (let index = 0; index < left.length; index++) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}

function enumerableSymbols(value: object): symbol[] {
  return Object.getOwnPropertySymbols(value).filter((key) => propertyIsEnumerable.call(value, key));
}

function shallowPlainObjectEqual(left: object, right: object): boolean {
  const leftRecord = left as Record<PropertyKey, unknown>;
  const rightRecord = right as Record<PropertyKey, unknown>;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!hasOwn.call(right, key) || !Object.is(leftRecord[key], rightRecord[key])) return false;
  }

  const leftSymbols = enumerableSymbols(left);
  const rightSymbols = enumerableSymbols(right);
  if (leftSymbols.length !== rightSymbols.length) return false;
  for (const key of leftSymbols) {
    if (!hasOwn.call(right, key) || !Object.is(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

/**
 * Compare supported materialized values one level deep using `Object.is`.
 *
 * Arrays, plain objects, Maps, Sets, and typed arrays compare their immediate
 * contents. Nested values retain identity semantics. Distinct unsupported
 * objects (for example class instances, Dates, promises, weak collections, or
 * DataViews) compare unequal, and values that cannot be inspected safely fall
 * back to unequal rather than throwing or hiding an update.
 */
export const shallowEqual: EqualityCheckFn = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (!isObject(left) || !isObject(right)) return false;

  try {
    if (Array.isArray(left) || Array.isArray(right)) {
      return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        Object.getPrototypeOf(left) === Array.prototype &&
        Object.getPrototypeOf(right) === Array.prototype &&
        shallowArrayEqual(left, right)
      );
    }

    if (left instanceof Map || right instanceof Map) {
      return (
        left instanceof Map &&
        right instanceof Map &&
        Object.getPrototypeOf(left) === Map.prototype &&
        Object.getPrototypeOf(right) === Map.prototype &&
        shallowMapEqual(left, right)
      );
    }

    if (left instanceof Set || right instanceof Set) {
      return (
        left instanceof Set &&
        right instanceof Set &&
        Object.getPrototypeOf(left) === Set.prototype &&
        Object.getPrototypeOf(right) === Set.prototype &&
        shallowSetEqual(left, right)
      );
    }

    const leftPrototype = Object.getPrototypeOf(left);
    const rightPrototype = Object.getPrototypeOf(right);
    const leftIsPlainObject = isPlainObjectPrototype(leftPrototype);
    const rightIsPlainObject = isPlainObjectPrototype(rightPrototype);
    if (leftIsPlainObject || rightIsPlainObject) {
      return (
        leftIsPlainObject &&
        rightIsPlainObject &&
        leftPrototype === rightPrototype &&
        shallowPlainObjectEqual(left, right)
      );
    }

    const leftTypedArray = asTypedArray(left, leftPrototype);
    const rightTypedArray = asTypedArray(right, rightPrototype);
    if (leftTypedArray !== undefined || rightTypedArray !== undefined) {
      return (
        leftTypedArray !== undefined &&
        rightTypedArray !== undefined &&
        shallowTypedArrayEqual(leftTypedArray, rightTypedArray)
      );
    }

    return false;
  } catch {
    return false;
  }
};

const defaultEqualityCheck: EqualityCheckFn = shallowEqual;

/** Return the framework fallback equality function for new and uncustomized runtimes. */
export function getDefaultEqualityCheck(): EqualityCheckFn {
  return defaultEqualityCheck;
}
