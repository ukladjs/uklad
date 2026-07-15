import { initAppDb } from '../db';
import { clearSubscriptionCache, getSubscriptionDiagnostics } from '../registrar';
import { getOrCreateSubscription, regSub } from '../subs';
import { getSubscriptionSnapshot, subscribeToSubscription } from '../subscription-runtime';
import type { SubVector } from '../types';

let computedRuns = 0;

describe('subscription diagnostics', () => {
  regSub('diagnostic-source');
  regSub(
    'diagnostic-double',
    (value: number) => {
      computedRuns++;
      return value * 2;
    },
    () => [['diagnostic-source']],
  );
  regSub(
    'diagnostic-maybe-error',
    (value: number) => {
      if (value < 0) throw new Error('diagnostic failure');
      return value;
    },
    () => [['diagnostic-source']],
  );
  regSub(
    'diagnostic-unprintable-error',
    (value: number) => {
      if (value < 0) throw Object.create(null);
      return value;
    },
    () => [['diagnostic-source']],
  );

  beforeEach(() => {
    clearSubscriptionCache();
    computedRuns = 0;
    initAppDb({ 'diagnostic-source': 1 });
  });

  it('reports cache state without evaluating subscriptions', () => {
    const subscription = getOrCreateSubscription(['diagnostic-double'])!;
    expect(getSubscriptionSnapshot(subscription)).toBe(2);
    expect(computedRuns).toBe(1);

    const diagnostics = getSubscriptionDiagnostics();
    expect(computedRuns).toBe(1);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: JSON.stringify(['diagnostic-source']),
          kind: 'root',
          active: false,
          status: 'value',
          value: 1,
        }),
        expect.objectContaining({
          key: JSON.stringify(['diagnostic-double']),
          kind: 'computed',
          active: false,
          status: 'value',
          value: 2,
        }),
      ]),
    );

    (diagnostics[0]!.query as SubVector)[0] = 'mutated-diagnostic';
    expect(
      getSubscriptionDiagnostics().every((item) => item.query[0] !== 'mutated-diagnostic'),
    ).toBe(true);
  });

  it('advances versions for changed active values and disappears on disposal', () => {
    const subscription = getOrCreateSubscription(['diagnostic-double'])!;
    const unsubscribe = subscribeToSubscription(subscription, () => {});
    const before = getSubscriptionDiagnostics().find(
      (item) => item.key === JSON.stringify(['diagnostic-double']),
    )!;

    initAppDb({ 'diagnostic-source': 2 });
    const after = getSubscriptionDiagnostics().find(
      (item) => item.key === JSON.stringify(['diagnostic-double']),
    )!;

    expect(after.active).toBe(true);
    expect(after.value).toBe(4);
    expect(after.version).toBeGreaterThan(before.version);

    unsubscribe();
    expect(
      getSubscriptionDiagnostics().some(
        (item) => item.key === JSON.stringify(['diagnostic-double']),
      ),
    ).toBe(false);
  });

  it('reports cached errors without throwing', () => {
    const subscription = getOrCreateSubscription(['diagnostic-maybe-error'])!;
    const unsubscribe = subscribeToSubscription(subscription, () => {});
    expect(getSubscriptionSnapshot(subscription)).toBe(1);

    initAppDb({ 'diagnostic-source': -1 });

    expect(() => getSubscriptionDiagnostics()).not.toThrow();
    expect(getSubscriptionDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: JSON.stringify(['diagnostic-maybe-error']),
          kind: 'computed',
          active: true,
          status: 'error',
          error: 'diagnostic failure',
        }),
      ]),
    );
    unsubscribe();
  });

  it('formats non-stringifiable thrown values without throwing', () => {
    const subscription = getOrCreateSubscription(['diagnostic-unprintable-error'])!;
    const unsubscribe = subscribeToSubscription(subscription, () => {});
    expect(getSubscriptionSnapshot(subscription)).toBe(1);

    initAppDb({ 'diagnostic-source': -1 });

    expect(getSubscriptionDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: JSON.stringify(['diagnostic-unprintable-error']),
          status: 'error',
          error: '[Unprintable subscription error]',
        }),
      ]),
    );
    unsubscribe();
  });
});
