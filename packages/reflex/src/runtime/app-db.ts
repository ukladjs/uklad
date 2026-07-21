import { scheduleAfterRender } from '../core/scheduling';
import { isRuntimeDisposed, type RuntimeScope } from './scope';
import {
  getCachedSubscriptionForRuntime,
  getRootSubIdBySourceForRuntime,
} from './subscriptions/cache';
import {
  assertPublicationAllowedForRuntime,
  publishSubscriptionsForRuntime,
  type SubscriptionNode,
} from './subscriptions/engine';
import { getRootSubKey } from './subscriptions/keys';

import type { Db, DefaultAppDb } from '../types';

export interface AppDbState {
  appDb: any;
  renderDb: any;
  flushScheduled: boolean;
}

function getAppDbState(runtime: RuntimeScope): AppDbState {
  return (runtime.appDb ??= {
    appDb: {},
    renderDb: {},
    flushScheduled: false,
  });
}

type NoInfer<T> = [T][T extends any ? 0 : never];

/** @internal Replace one runtime's db heads and publish surviving roots. */
export function initAppDbForRuntime<T = DefaultAppDb>(
  runtime: RuntimeScope,
  value: Db<NoInfer<T>>,
): void {
  assertPublicationAllowedForRuntime(runtime);
  const state = getAppDbState(runtime);
  const oldDb = state.renderDb;
  state.appDb = value;
  state.renderDb = value;
  publishSubscriptionsForRuntime(runtime, collectChangedRoots(runtime, oldDb, value));
}

/** @internal Return the latest committed db for one runtime. */
export function getAppDbForRuntime<T = DefaultAppDb>(runtime: RuntimeScope): Db<T> {
  return getAppDbState(runtime).appDb as Db<T>;
}

/** @internal Return one runtime's render-visible db generation. */
export function getRenderDbForRuntime<T = DefaultAppDb>(runtime: RuntimeScope): Db<T> {
  return getAppDbState(runtime).renderDb as Db<T>;
}

/** @internal Commit one runtime's db generation and schedule publication. */
export function updateAppDbForRuntime<T = Record<string, any>>(
  runtime: RuntimeScope,
  newDb: Db<T>,
): void {
  const state = getAppDbState(runtime);
  if (newDb === state.appDb) return;
  state.appDb = newDb;
  if (state.flushScheduled) return;
  state.flushScheduled = true;
  scheduleAfterRender(() => {
    state.flushScheduled = false;
    if (isRuntimeDisposed(runtime)) return;
    flushSubscriptionsForRuntime(runtime);
  });
}

/** @internal Publish one runtime's latest db generation synchronously. */
export function flushSubscriptionsForRuntime(runtime: RuntimeScope): void {
  const state = getAppDbState(runtime);
  if (state.renderDb === state.appDb) return;
  assertPublicationAllowedForRuntime(runtime);
  const oldDb = state.renderDb;
  const newDb = state.appDb;
  state.renderDb = newDb;
  publishSubscriptionsForRuntime(runtime, collectChangedRoots(runtime, oldDb, newDb));
}

/** @internal Return whether one runtime still has an unflushed db generation. */
export function hasPendingDbFlushForRuntime(runtime: RuntimeScope): boolean {
  const state = getAppDbState(runtime);
  return state.renderDb !== state.appDb;
}

function collectChangedRoots(
  runtime: RuntimeScope,
  oldDb: any,
  newDb: any,
): SubscriptionNode<any>[] {
  const dirtyRoots: SubscriptionNode<any>[] = [];
  const keys = new Set([...Object.keys(oldDb), ...Object.keys(newDb)]);
  for (const key of keys) {
    if (Object.is(oldDb[key], newDb[key])) continue;

    const subId = getRootSubIdBySourceForRuntime(runtime, key);
    if (subId === undefined) continue;

    const subscription = getCachedSubscriptionForRuntime(runtime, getRootSubKey(subId));
    if (subscription) dirtyRoots.push(subscription);
  }
  return dirtyRoots;
}
