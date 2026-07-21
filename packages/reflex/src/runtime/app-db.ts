import { scheduleAfterRender } from '../core/scheduling';
import { isRuntimeDisposed, type RuntimeKernel } from './kernel';
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
}

function getAppDbState(runtime: RuntimeKernel): AppDbState {
  return (runtime.appDb ??= {
    appDb: {},
    renderDb: {},
    flushScheduled: false,
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
  state.appDb = value;
  state.renderDb = value;
  publishSubscriptionsForKernel(runtime, collectChangedRoots(runtime, oldDb, value));
}

/** @internal Return the latest committed db for one runtime. */
export function getAppDbForKernel<T = DefaultAppDb>(runtime: RuntimeKernel): Db<T> {
  return getAppDbState(runtime).appDb as Db<T>;
}

/** @internal Return one runtime's render-visible db generation. */
export function getRenderDbForKernel<T = DefaultAppDb>(runtime: RuntimeKernel): Db<T> {
  return getAppDbState(runtime).renderDb as Db<T>;
}

/** @internal Commit one runtime's db generation and schedule publication. */
export function updateAppDbForKernel<T = Record<string, any>>(
  runtime: RuntimeKernel,
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
    flushSubscriptionsForKernel(runtime);
  });
}

/** @internal Publish one runtime's latest db generation synchronously. */
export function flushSubscriptionsForKernel(runtime: RuntimeKernel): void {
  const state = getAppDbState(runtime);
  if (state.renderDb === state.appDb) return;
  assertPublicationAllowedForKernel(runtime);
  const oldDb = state.renderDb;
  const newDb = state.appDb;
  state.renderDb = newDb;
  publishSubscriptionsForKernel(runtime, collectChangedRoots(runtime, oldDb, newDb));
}

/** @internal Return whether one runtime still has an unflushed db generation. */
export function hasPendingDbFlushForKernel(runtime: RuntimeKernel): boolean {
  const state = getAppDbState(runtime);
  return state.renderDb !== state.appDb;
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
