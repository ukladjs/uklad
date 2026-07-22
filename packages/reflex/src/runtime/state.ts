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

import type { State, DefaultAppState } from '../types';

export interface StateStore {
  state: any;
  renderState: any;
  flushScheduled: boolean;
  initialized: boolean;
  committedRevision: number;
  publishedRevision: number;
}

/** Monotonic state-generation counters owned by one runtime. */
export interface StateRevisions {
  readonly committedRevision: number;
  readonly publishedRevision: number;
}

function getStateStore(runtime: RuntimeKernel): StateStore {
  return (runtime.state ??= {
    state: {},
    renderState: {},
    flushScheduled: false,
    initialized: false,
    committedRevision: 0,
    publishedRevision: 0,
  });
}

type NoInfer<T> = [T][T extends any ? 0 : never];

/** @internal Replace one runtime's state heads and publish surviving roots. */
export function initStateForKernel<T = DefaultAppState>(
  runtime: RuntimeKernel,
  value: State<NoInfer<T>>,
): void {
  assertPublicationAllowedForKernel(runtime);
  const state = getStateStore(runtime);
  const oldState = state.renderState;
  const changed = value !== state.state;
  const acceptedValue = value;
  if (state.initialized && changed) state.committedRevision++;
  state.initialized = true;
  state.state = acceptedValue;
  state.renderState = acceptedValue;
  const recalculated = publishSubscriptionsForKernel(
    runtime,
    collectChangedRoots(runtime, oldState, acceptedValue),
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

/** @internal Return the latest committed state for one runtime. */
export function getStateForKernel<T = DefaultAppState>(runtime: RuntimeKernel): State<T> {
  return getStateStore(runtime).state as State<T>;
}

/** @internal Return one runtime's render-visible state generation. */
export function getRenderStateForKernel<T = DefaultAppState>(runtime: RuntimeKernel): State<T> {
  return getStateStore(runtime).renderState as State<T>;
}

/** @internal Return one runtime's committed and render-published generations. */
export function getStateRevisionsForKernel(runtime: RuntimeKernel): StateRevisions {
  const state = getStateStore(runtime);
  return {
    committedRevision: state.committedRevision,
    publishedRevision: state.publishedRevision,
  };
}

/** @internal Commit one runtime's state generation and schedule publication. */
export function updateStateForKernel<T = Record<string, any>>(
  runtime: RuntimeKernel,
  newState: State<T>,
): number {
  const state = getStateStore(runtime);
  if (newState === state.state) return state.committedRevision;
  const previousState = state.state;
  state.initialized = true;
  state.state = newState;
  state.committedRevision++;
  notifyRuntimeLifecycleForKernel(
    runtime,
    'onStateCommitted',
    previousState,
    newState,
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

/** @internal Publish one runtime's latest state generation synchronously. */
export function flushSubscriptionsForKernel(runtime: RuntimeKernel): void {
  const state = getStateStore(runtime);
  if (state.renderState === state.state && state.publishedRevision === state.committedRevision)
    return;
  assertPublicationAllowedForKernel(runtime);
  const oldState = state.renderState;
  const newState = state.state;
  const targetRevision = state.committedRevision;
  state.renderState = newState;
  const recalculated = publishSubscriptionsForKernel(
    runtime,
    collectChangedRoots(runtime, oldState, newState),
  );
  state.publishedRevision = targetRevision;
  notifyRuntimeLifecycleForKernel(
    runtime,
    'onStatePublished',
    newState,
    targetRevision,
    recalculated,
  );
}

/** @internal Return whether one runtime still has an unflushed state generation. */
export function hasPendingStateFlushForKernel(runtime: RuntimeKernel): boolean {
  const state = getStateStore(runtime);
  return state.publishedRevision !== state.committedRevision;
}

function collectChangedRoots(
  runtime: RuntimeKernel,
  oldState: any,
  newState: any,
): SubscriptionNode<any>[] {
  const dirtyRoots: SubscriptionNode<any>[] = [];
  const keys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);
  for (const key of keys) {
    if (Object.is(oldState[key], newState[key])) continue;

    const subId = getRootSubIdBySourceForKernel(runtime, key);
    if (subId === undefined) continue;

    const subscription = getCachedSubscriptionForKernel(runtime, getRootSubKey(subId));
    if (subscription) dirtyRoots.push(subscription);
  }
  return dirtyRoots;
}
