import { scheduleAfterRender } from '../core/scheduling';
import { isRuntimeDisposed, type RuntimeCore } from './core';
import { notifyRuntimeProbe } from './probe';
import type { SubscriptionNode } from './subscriptions/types';
import { getRootSubKey } from './subscriptions/keys';

import type { State, DefaultAppState } from '../types';

/** Monotonic state-generation counters owned by one runtime. */
export interface StateRevisions {
  readonly committedRevision: number;
  readonly publishedRevision: number;
}

type NoInfer<T> = [T][T extends any ? 0 : never];

export class StateStore {
  state: any = {};
  renderState: any = {};
  flushScheduled = false;
  initialized = false;
  committedRevision = 0;
  publishedRevision = 0;

  private readonly getRuntime: () => RuntimeCore;

  constructor(getRuntime: () => RuntimeCore) {
    this.getRuntime = getRuntime;
  }

  initialize<T = DefaultAppState>(value: State<NoInfer<T>>): void {
    initializeState(this.getRuntime(), this, value);
  }

  get<T = DefaultAppState>(): State<T> {
    return this.state as State<T>;
  }

  getRender<T = DefaultAppState>(): State<T> {
    return this.renderState as State<T>;
  }

  getRevisions(): StateRevisions {
    return {
      committedRevision: this.committedRevision,
      publishedRevision: this.publishedRevision,
    };
  }

  commit<T = Record<string, any>>(newState: State<T>): number {
    return commitState(this.getRuntime(), this, newState);
  }

  publish(): void {
    publishState(this.getRuntime(), this);
  }

  get hasPendingPublication(): boolean {
    return this.publishedRevision !== this.committedRevision;
  }
}

function initializeState<T = DefaultAppState>(
  runtime: RuntimeCore,
  state: StateStore,
  value: State<NoInfer<T>>,
): void {
  runtime.subscriptions.assertPublicationAllowed();
  const oldState = state.renderState;
  const changed = value !== state.state;
  const acceptedValue = value;
  if (state.initialized && changed) state.committedRevision++;
  state.initialized = true;
  state.state = acceptedValue;
  state.renderState = acceptedValue;
  const includeEvidence = runtime.probe?.needsSubscriptionEvidence === true;
  const recalculated = runtime.subscriptions.publish(
    collectChangedRoots(runtime, oldState, acceptedValue),
    includeEvidence,
  );
  state.publishedRevision = state.committedRevision;
  if (runtime.probe) {
    notifyRuntimeProbe(
      runtime,
      'published',
      acceptedValue,
      state.publishedRevision,
      includeEvidence ? recalculated : undefined,
    );
  }
}

function commitState<T = Record<string, any>>(
  runtime: RuntimeCore,
  state: StateStore,
  newState: State<T>,
): number {
  if (newState === state.state) return state.committedRevision;
  const previousState = state.state;
  state.initialized = true;
  state.state = newState;
  state.committedRevision++;
  if (runtime.probe) {
    notifyRuntimeProbe(runtime, 'stateCommitted', previousState, newState, state.committedRevision);
  }
  if (state.flushScheduled) return state.committedRevision;
  state.flushScheduled = true;
  scheduleAfterRender(() => {
    state.flushScheduled = false;
    if (isRuntimeDisposed(runtime)) return;
    state.publish();
  });
  return state.committedRevision;
}

function publishState(runtime: RuntimeCore, state: StateStore): void {
  if (state.renderState === state.state && state.publishedRevision === state.committedRevision)
    return;
  runtime.subscriptions.assertPublicationAllowed();
  const oldState = state.renderState;
  const newState = state.state;
  const targetRevision = state.committedRevision;
  state.renderState = newState;
  const includeEvidence = runtime.probe?.needsSubscriptionEvidence === true;
  const recalculated = runtime.subscriptions.publish(
    collectChangedRoots(runtime, oldState, newState),
    includeEvidence,
  );
  state.publishedRevision = targetRevision;
  if (runtime.probe) {
    notifyRuntimeProbe(
      runtime,
      'published',
      newState,
      targetRevision,
      includeEvidence ? recalculated : undefined,
    );
  }
}

function collectChangedRoots(
  runtime: RuntimeCore,
  oldState: any,
  newState: any,
): SubscriptionNode<any>[] {
  const dirtyRoots: SubscriptionNode<any>[] = [];
  const keys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);
  for (const key of keys) {
    if (Object.is(oldState[key], newState[key])) continue;

    const subId = runtime.subscriptions.getRootId(key);
    if (subId === undefined) continue;

    const subscription = runtime.subscriptions.getCached(getRootSubKey(subId));
    if (subscription) dirtyRoots.push(subscription);
  }
  return dirtyRoots;
}
