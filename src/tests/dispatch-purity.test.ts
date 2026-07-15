/**
 * Dev-mode purity guard: calling dispatch() directly from inside an event
 * handler warns (handlers must return a ['dispatch', ...] effect instead),
 * while the legitimate paths — the built-in 'dispatch' effect, and dispatch
 * from application code outside handlers — stay silent.
 */
// Force the dev path: IS_DEV is derived from NODE_ENV at import time, which
// is 'test' under jest. jest.mock is hoisted above imports, so router.ts sees
// IS_DEV === true in this file only.
jest.mock('../env', () => ({ IS_DEV: true }));

import { regEvent } from '../events';
import { dispatch, dispatchSync } from '../router';
import { initAppDb, getAppDb } from '../db';
import { waitForScheduled } from './test-utils';

const purityWarnings = () =>
  getTestLogCalls().warn.filter((call: any[]) =>
    String(call[0]).includes('from inside the event handler'),
  );

describe('dev warning: dispatch called from an event handler', () => {
  beforeEach(() => {
    initAppDb({ outer: 0, inner: 0 });
  });

  it('should warn but still queue the event', async () => {
    regEvent('purity-inner', ({ draftDb }) => {
      draftDb.inner += 1;
    });
    regEvent('purity-outer', ({ draftDb }) => {
      draftDb.outer += 1;
      dispatch(['purity-inner']); // impure: should be a ['dispatch', ...] effect
    });

    dispatch(['purity-outer']);
    await waitForScheduled();
    await waitForScheduled();

    const warnings = purityWarnings();
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]![0])).toContain("'purity-inner'");
    expect(String(warnings[0]![0])).toContain("'purity-outer'");

    // Behavior is preserved: both events processed
    expect(getAppDb().outer).toBe(1);
    expect(getAppDb().inner).toBe(1);
  });

  it('should not warn for events emitted through the dispatch effect', async () => {
    regEvent('purity-fx-inner', ({ draftDb }) => {
      draftDb.inner += 1;
    });
    regEvent('purity-fx-outer', ({ draftDb }) => {
      draftDb.outer += 1;
      return [['dispatch', ['purity-fx-inner']]];
    });

    dispatch(['purity-fx-outer']);
    await waitForScheduled();
    await waitForScheduled();

    expect(purityWarnings()).toHaveLength(0);
    expect(getAppDb().inner).toBe(1);
  });

  it('should not warn for dispatch outside event handling', async () => {
    regEvent('purity-plain', ({ draftDb }) => {
      draftDb.outer += 1;
    });

    dispatch(['purity-plain']);
    await waitForScheduled();

    expect(purityWarnings()).toHaveLength(0);
  });

  it('should warn from handlers run through dispatchSync too', () => {
    regEvent('purity-sync-inner', ({ draftDb }) => {
      draftDb.inner += 1;
    });
    regEvent('purity-sync-outer', ({ draftDb }) => {
      draftDb.outer += 1;
      dispatch(['purity-sync-inner']);
    });

    dispatchSync(['purity-sync-outer']);

    expect(purityWarnings()).toHaveLength(1);
  });
});
