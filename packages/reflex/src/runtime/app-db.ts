import { scheduleAfterRender } from '../core/scheduling';
import { cloneStructuredValue } from './ownership';
import { defaultRuntimeScope, isRuntimeDisposed, type RuntimeScope } from './scope';
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

interface AppDbState {
  appDb: any;
  renderDb: any;
  flushScheduled: boolean;
  initialized: boolean;
  committedRevision: number;
  publishedRevision: number;
}

/** @internal Monotonic state-generation counters owned by one runtime. */
export interface AppDbRevisions {
  readonly committedRevision: number;
  readonly publishedRevision: number;
}

const appDbStates = new WeakMap<RuntimeScope, AppDbState>();

function getAppDbState(runtime: RuntimeScope): AppDbState {
  let state = appDbStates.get(runtime);
  if (!state) {
    state = {
      appDb: {},
      renderDb: {},
      flushScheduled: false,
      initialized: false,
      committedRevision: 0,
      publishedRevision: 0,
    };
    appDbStates.set(runtime, state);
  }
  return state;
}

type NoInfer<T> = [T][T extends any ? 0 : never];

/** Replace the compatibility runtime's app-db and publish surviving roots. */
export function initAppDb<T = DefaultAppDb>(value: Db<NoInfer<T>>): void {
  initAppDbForRuntime(defaultRuntimeScope, value);
}

/** @internal Replace one runtime's db heads and publish surviving roots. */
export function initAppDbForRuntime<T = DefaultAppDb>(
  runtime: RuntimeScope,
  value: Db<NoInfer<T>>,
): void {
  assertPublicationAllowedForRuntime(runtime);
  const state = getAppDbState(runtime);
  const oldDb = state.renderDb;
  if (state.initialized && value !== state.appDb) state.committedRevision++;
  const acceptedValue = value === state.appDb ? value : ownAppDbValue(value);
  state.initialized = true;
  state.appDb = acceptedValue;
  state.renderDb = acceptedValue;
  const targetRevision = state.committedRevision;
  publishSubscriptionsForRuntime(runtime, collectChangedRoots(runtime, oldDb, acceptedValue));
  state.publishedRevision = targetRevision;
}

/** Return the latest committed compatibility app-db. */
export function getAppDb<T = DefaultAppDb>(): Db<T> {
  return getAppDbForRuntime<T>(defaultRuntimeScope);
}

/** @internal Return the latest committed db for one runtime. */
export function getAppDbForRuntime<T = DefaultAppDb>(runtime: RuntimeScope): Db<T> {
  return getAppDbState(runtime).appDb as Db<T>;
}

/** Return the compatibility runtime's render-visible db generation. */
export function getRenderDb<T = DefaultAppDb>(): Db<T> {
  return getRenderDbForRuntime<T>(defaultRuntimeScope);
}

/** @internal Return one runtime's render-visible db generation. */
export function getRenderDbForRuntime<T = DefaultAppDb>(runtime: RuntimeScope): Db<T> {
  return getAppDbState(runtime).renderDb as Db<T>;
}

/** @internal Return one runtime's committed and render-published generations. */
export function getAppDbRevisionsForRuntime(runtime: RuntimeScope): AppDbRevisions {
  const state = getAppDbState(runtime);
  return {
    committedRevision: state.committedRevision,
    publishedRevision: state.publishedRevision,
  };
}

/** Commit a compatibility db generation and schedule subscription publication. */
export function updateAppDb<T = Record<string, any>>(newDb: Db<T>): void {
  updateAppDbForRuntime(defaultRuntimeScope, newDb);
}

/** @internal Commit one runtime's db generation and schedule publication. */
export function updateAppDbForRuntime<T = Record<string, any>>(
  runtime: RuntimeScope,
  newDb: Db<T>,
): number {
  const state = getAppDbState(runtime);
  if (newDb === state.appDb) return state.committedRevision;
  state.initialized = true;
  state.appDb = newDb;
  state.committedRevision++;
  if (state.flushScheduled) return state.committedRevision;
  state.flushScheduled = true;
  scheduleAfterRender(() => {
    state.flushScheduled = false;
    if (isRuntimeDisposed(runtime)) return;
    flushSubscriptionsForRuntime(runtime);
  });
  return state.committedRevision;
}

/** Publish the compatibility runtime's latest db generation. */
export function flushSubscriptions(): void {
  flushSubscriptionsForRuntime(defaultRuntimeScope);
}

/** @internal Publish one runtime's latest db generation synchronously. */
export function flushSubscriptionsForRuntime(runtime: RuntimeScope): void {
  const state = getAppDbState(runtime);
  if (state.renderDb === state.appDb && state.publishedRevision === state.committedRevision) return;
  assertPublicationAllowedForRuntime(runtime);
  const oldDb = state.renderDb;
  const newDb = state.appDb;
  const targetRevision = state.committedRevision;
  state.renderDb = newDb;
  publishSubscriptionsForRuntime(runtime, collectChangedRoots(runtime, oldDb, newDb));
  state.publishedRevision = targetRevision;
}

/** @internal Return whether one runtime still has an unflushed db generation. */
export function hasPendingDbFlushForRuntime(runtime: RuntimeScope): boolean {
  const state = getAppDbState(runtime);
  return state.publishedRevision !== state.committedRevision;
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

function ownAppDbValue<T>(value: T): T {
  try {
    return deepFreezeOwnedValue(cloneStructuredValue(value), new WeakSet<object>());
  } catch (error: unknown) {
    throw new Error(
      '[reflex] app-db ingress must be structured-cloneable so the runtime owns its state generation.',
      { cause: error },
    );
  }
}

function deepFreezeOwnedValue<T>(value: T, seen: WeakSet<object>): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreezeOwnedValue((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}
