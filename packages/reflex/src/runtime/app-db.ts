import { scheduleAfterRender } from '../core/scheduling';
import { isRuntimeDisposed, type RuntimeKernel } from './kernel';
import { notifyRuntimeLifecycleForKernel } from './lifecycle';
import {
  getCachedSubscriptionForKernel,
  getRootSubIdBySourceForKernel,
} from './subscriptions/cache';
import {
  assertPublicationAllowedForKernel,
  publishSubscriptionsForKernel,
  type SubscriptionNode,
} from './subscriptions/engine';
import { getRootSubKey } from './subscriptions/keys';

import type { Db, DefaultAppDb } from '../types';

export interface AppDbState {
  appDb: any;
  renderDb: any;
  flushScheduled: boolean;
  initialized: boolean;
  committedRevision: number;
  publishedRevision: number;
}

/** Monotonic state-generation counters owned by one runtime. */
export interface AppDbRevisions {
  readonly committedRevision: number;
  readonly publishedRevision: number;
}

function getAppDbState(runtime: RuntimeKernel): AppDbState {
  return (runtime.appDb ??= {
    appDb: {},
    renderDb: {},
    flushScheduled: false,
    initialized: false,
    committedRevision: 0,
    publishedRevision: 0,
  });
}

type NoInfer<T> = [T][T extends any ? 0 : never];

/** @internal Replace one runtime's db heads and publish surviving roots. */
export function initAppDbForKernel<T = DefaultAppDb>(
  runtime: RuntimeKernel,
  value: Db<NoInfer<T>>,
): void {
  assertPublicationAllowedForKernel(runtime);
  const state = getAppDbState(runtime);
  const oldDb = state.renderDb;
  const changed = value !== state.appDb;
  const acceptedValue = value;
  if (state.initialized && changed) state.committedRevision++;
  state.initialized = true;
  state.appDb = acceptedValue;
  state.renderDb = acceptedValue;
  const recalculated = publishSubscriptionsForKernel(
    runtime,
    collectChangedRoots(runtime, oldDb, acceptedValue),
  );
  state.publishedRevision = state.committedRevision;
  notifyRuntimeLifecycleForKernel(
    runtime,
    'onStatePublished',
    acceptedValue,
    state.publishedRevision,
    recalculated,
  );
}

/** @internal Return the latest committed db for one runtime. */
export function getAppDbForKernel<T = DefaultAppDb>(runtime: RuntimeKernel): Db<T> {
  return getAppDbState(runtime).appDb as Db<T>;
}

/** @internal Return one runtime's render-visible db generation. */
export function getRenderDbForKernel<T = DefaultAppDb>(runtime: RuntimeKernel): Db<T> {
  return getAppDbState(runtime).renderDb as Db<T>;
}

/** @internal Return one runtime's committed and render-published generations. */
export function getAppDbRevisionsForKernel(runtime: RuntimeKernel): AppDbRevisions {
  const state = getAppDbState(runtime);
  return {
    committedRevision: state.committedRevision,
    publishedRevision: state.publishedRevision,
  };
}

/** @internal Commit one runtime's db generation and schedule publication. */
export function updateAppDbForKernel<T = Record<string, any>>(
  runtime: RuntimeKernel,
  newDb: Db<T>,
): number {
  const state = getAppDbState(runtime);
  if (newDb === state.appDb) return state.committedRevision;
  const previousDb = state.appDb;
  state.initialized = true;
  state.appDb = newDb;
  state.committedRevision++;
  notifyRuntimeLifecycleForKernel(
    runtime,
    'onStateCommitted',
    previousDb,
    newDb,
    state.committedRevision,
  );
  if (state.flushScheduled) return state.committedRevision;
  state.flushScheduled = true;
  scheduleAfterRender(() => {
    state.flushScheduled = false;
    if (isRuntimeDisposed(runtime)) return;
    flushSubscriptionsForKernel(runtime);
  });
  return state.committedRevision;
}

/** @internal Publish one runtime's latest db generation synchronously. */
export function flushSubscriptionsForKernel(runtime: RuntimeKernel): void {
  const state = getAppDbState(runtime);
  if (state.renderDb === state.appDb && state.publishedRevision === state.committedRevision) return;
  assertPublicationAllowedForKernel(runtime);
  const oldDb = state.renderDb;
  const newDb = state.appDb;
  const targetRevision = state.committedRevision;
  state.renderDb = newDb;
  const recalculated = publishSubscriptionsForKernel(
    runtime,
    collectChangedRoots(runtime, oldDb, newDb),
  );
  state.publishedRevision = targetRevision;
  notifyRuntimeLifecycleForKernel(
    runtime,
    'onStatePublished',
    newDb,
    targetRevision,
    recalculated,
  );
}

/** @internal Return whether one runtime still has an unflushed db generation. */
export function hasPendingDbFlushForKernel(runtime: RuntimeKernel): boolean {
  const state = getAppDbState(runtime);
  return state.publishedRevision !== state.committedRevision;
}

function collectChangedRoots(
  runtime: RuntimeKernel,
  oldDb: any,
  newDb: any,
): SubscriptionNode<any>[] {
  const dirtyRoots: SubscriptionNode<any>[] = [];
  const keys = new Set([...Object.keys(oldDb), ...Object.keys(newDb)]);
  for (const key of keys) {
    if (Object.is(oldDb[key], newDb[key])) continue;

    const subId = getRootSubIdBySourceForKernel(runtime, key);
    if (subId === undefined) continue;

    const subscription = getCachedSubscriptionForKernel(runtime, getRootSubKey(subId));
    if (subscription) dirtyRoots.push(subscription);
  }
  return dirtyRoots;
}
