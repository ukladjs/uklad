/**
 * @jest-environment jsdom
 */
// Force the dev path: IS_DEV is derived from NODE_ENV at import time, which
// is 'test' under jest. jest.mock is hoisted above imports, so subs.ts sees
// IS_DEV === true in this file only.
jest.mock('../env', () => ({ IS_DEV: true }));

import { renderHook } from '@testing-library/react';
import { regSub, getOrCreateSubscription } from '../subs';
import { useSubscription } from '../hook';
import { initAppDb } from '../db';
import { clearSubscriptionCache } from '../registrar';

describe('Dev warnings for non-serializable subscription params', () => {
  regSub('warn-items');
  regSub(
    'warn-by-filter',
    (items) => items,
    () => [['warn-items']],
  );
  regSub(
    'warn-by-query',
    (items) => items,
    () => [['warn-items']],
  );
  regSub(
    'warn-hook-circular',
    (items) => items,
    () => [['warn-items']],
  );
  regSub(
    'warn-hook-bigint',
    (items) => items,
    () => [['warn-items']],
  );

  const warnCallsContaining = (fragment: string) =>
    getTestLogCalls().warn.filter((call: any[]) => String(call[0]).includes(fragment));

  beforeEach(() => {
    initAppDb({ 'warn-items': [] });
    clearSubscriptionCache();
    clearTestLogCalls();
  });

  it('should warn on first use of a non-serializable param', () => {
    getOrCreateSubscription(['warn-by-query', new Set([1])]);

    expect(warnCallsContaining("subscription 'warn-by-query'")).toHaveLength(1);
  });

  it('should warn even when the serialized key collides with a cached subscription', () => {
    // A safe param caches the key '["warn-by-filter",{}]'
    const cached = getOrCreateSubscription(['warn-by-filter', {}]);
    expect(warnCallsContaining("subscription 'warn-by-filter'")).toHaveLength(0);

    // A Map also serializes to {} -> cache hit returns the wrong subscription;
    // validation must run before the lookup so this still warns
    const colliding = getOrCreateSubscription(['warn-by-filter', new Map([['a', 1]])]);

    expect(colliding).toBe(cached); // documents the collision behavior
    expect(warnCallsContaining("subscription 'warn-by-filter'")).toHaveLength(1);
  });

  it('should warn through the React hook before a circular param throws', () => {
    // React also reports render errors via console.error; keep output clean
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const circular: any = { a: 1 };
    circular.self = circular;

    // Key generation still throws (fail fast on a programming error), but
    // the actionable dev warning must fire first
    expect(() => {
      renderHook(() => useSubscription(['warn-hook-circular', circular]));
    }).toThrow();
    expect(warnCallsContaining("subscription 'warn-hook-circular'")).toHaveLength(1);

    consoleError.mockRestore();
  });

  it('should warn through the React hook before a BigInt param throws', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useSubscription(['warn-hook-bigint', BigInt(1) as any]));
    }).toThrow();
    expect(warnCallsContaining("subscription 'warn-hook-bigint'")).toHaveLength(1);

    consoleError.mockRestore();
  });
});
