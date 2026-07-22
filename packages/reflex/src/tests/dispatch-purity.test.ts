/**
 * Dev-mode purity guard: calling dispatch() directly from inside an event
 * handler warns (handlers must return a ['dispatch', ...] effect instead),
 * while the legitimate paths — the built-in 'dispatch' effect, and dispatch
 * from application code outside handlers — stay silent.
 */
// IS_DEV is captured at import time; Jest hoists this mock so the event router
// takes its development-only branch in this suite.
jest.mock('../core/environment', () => ({ IS_DEV: true }));

import { dispatch, dispatchSync, getState, initState, regEvent } from './runtime-test-api';
import { waitForScheduled } from './test-utils';

const purityWarnings = () =>
  getTestLogCalls().warn.filter((call: any[]) =>
    String(call[0]).includes('from inside the event handler'),
  );

describe('dev warning: dispatch called from an event handler', () => {
  beforeEach(() => {
    initState({ outer: 0, inner: 0 });
  });

  it('should warn but still queue the event', async () => {
    regEvent('purity-inner', ({ draftState }) => {
      draftState.inner += 1;
    });
    regEvent('purity-outer', ({ draftState }) => {
      draftState.outer += 1;
      dispatch(['purity-inner']); // impure: should be a ['dispatch', ...] effect
    });

    dispatch(['purity-outer']);
    await waitForScheduled();
    await waitForScheduled();

    const warnings = purityWarnings();
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]![0])).toContain("'purity-inner'");
    expect(String(warnings[0]![0])).toContain("'purity-outer'");

    expect(getState().outer).toBe(1);
    expect(getState().inner).toBe(1);
  });

  it('should not warn for events emitted through the dispatch effect', async () => {
    regEvent('purity-fx-inner', ({ draftState }) => {
      draftState.inner += 1;
    });
    regEvent('purity-fx-outer', ({ draftState }) => {
      draftState.outer += 1;
      return [['dispatch', ['purity-fx-inner']]];
    });

    dispatch(['purity-fx-outer']);
    await waitForScheduled();
    await waitForScheduled();

    expect(purityWarnings()).toHaveLength(0);
    expect(getState().inner).toBe(1);
  });

  it('should not warn for dispatch outside event handling', async () => {
    regEvent('purity-plain', ({ draftState }) => {
      draftState.outer += 1;
    });

    dispatch(['purity-plain']);
    await waitForScheduled();

    expect(purityWarnings()).toHaveLength(0);
  });

  it('should warn from handlers run through dispatchSync too', () => {
    regEvent('purity-sync-inner', ({ draftState }) => {
      draftState.inner += 1;
    });
    regEvent('purity-sync-outer', ({ draftState }) => {
      draftState.outer += 1;
      dispatch(['purity-sync-inner']);
    });

    dispatchSync(['purity-sync-outer']);

    expect(purityWarnings()).toHaveLength(1);
  });
});
