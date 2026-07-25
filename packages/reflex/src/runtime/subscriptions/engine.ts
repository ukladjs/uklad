import { consoleLog } from '../../core/logging';
import { SubscriptionCell } from './cell';
import { type RuntimeCore } from '../core';

import type { EqualityCheckFn, SubVector } from '../../types';
import type { RuntimeProbeSubscription } from '../probe';
import type { SubscriptionListenerKind, SubscriptionListenerRegistration } from './cell';

export type { SubscriptionListenerKind } from './cell';

declare const subscriptionNodeType: unique symbol;

const NO_RECALCULATED_SUBSCRIPTIONS: readonly RuntimeProbeSubscription[] = Object.freeze([]);

/** Opaque runtime-owned handle. Runtime operations are the entire contract. */
export interface SubscriptionNode<T> {
  readonly [subscriptionNodeType]: T;
}

export type SubscriptionKind = 'root' | 'computed';

export interface SubscriptionSpec<T> {
  key: string;
  query: SubVector;
  kind: SubscriptionKind;
  compute: (...dependencyValues: any[]) => T;
  dependencies: SubscriptionNode<any>[];
  equalityCheck: EqualityCheckFn;
  onActive: () => void;
  onUnused: () => void;
}

/** Read-only cached state for devtools; never exposes the runtime node. */
export interface SubscriptionDiagnostic {
  readonly key: string;
  readonly query: Readonly<SubVector>;
  readonly kind: SubscriptionKind;
  readonly active: boolean;
  readonly version: number;
  readonly status: 'empty' | 'value' | 'error';
  readonly value?: unknown;
  readonly error?: string;
}

function formatDiagnosticError(error: unknown): string {
  try {
    return error instanceof Error ? String(error.message) : String(error);
  } catch {
    return '[Unprintable subscription error]';
  }
}

/**
 * Owns the lifecycle of opaque subscription cells.
 *
 * Active graphs settle in topological order when STATE roots are published. Dormant
 * graphs are validated lazily by a memoized pull. STATE publication is already the
 * scheduler, so this engine deliberately owns no node tasks or notification debt.
 */
export class SubscriptionEngine {
  private readonly getRuntime: () => RuntimeCore;

  constructor(getRuntime: () => RuntimeCore) {
    this.getRuntime = getRuntime;
  }

  get runtime(): RuntimeCore {
    return this.getRuntime();
  }
  /** Deduplicates cells visited during one dormant graph traversal. */
  private pullEpoch = 0;
  /** Deduplicates active cells queued during one root publication. */
  private wave = 0;
  /** Monotonic observable-version source shared by every cell. */
  private outputStamp = 0;
  /** Marks the latest STATE generation against which a cell was validated. */
  private publicationEpoch = 1;
  /** Records settle/notify phases for reentrancy guards and deferred release. */
  private phase: 'idle' | 'settling' | 'notifying' = 'idle';
  /** Defers listener-triggered releases until notification snapshots finish. */
  private deferredReleases = new Set<SubscriptionCell<any>>();
  /** Makes destructive registry clears fail while any graph is live. */
  private activeNodes = 0;

  create<T>(spec: SubscriptionSpec<T>): SubscriptionNode<T> {
    if (this.phase === 'settling') {
      throw new Error(
        '[reflex] Creating subscriptions during subscription computation is not allowed.',
      );
    }
    if (spec.kind === 'root' && spec.dependencies.length !== 0) {
      throw new Error(`[reflex] Root subscription ${spec.key} cannot have dependencies.`);
    }
    return new SubscriptionCell(this, spec) as unknown as SubscriptionNode<T>;
  }

  read<T>(node: SubscriptionNode<T>): T {
    return this.getSnapshot(node);
  }

  getSnapshot<T>(node: SubscriptionNode<T>): T {
    if (this.phase === 'settling') {
      throw new Error(
        '[reflex] Subscription reads are not allowed during subscription computation.',
      );
    }
    const subscription = this.unwrap(node);
    if (subscription.disposed) {
      throw new Error(
        `[reflex] Subscription ${subscription.spec.key} was disposed; reacquire it by key.`,
      );
    }
    if (subscription.hasError) {
      this.pull(subscription, true);
    } else if (!subscription.active && subscription.validatedEpoch !== this.publicationEpoch) {
      this.pull(subscription, false);
    }
    return subscription.current;
  }

  subscribe<T>(
    node: SubscriptionNode<T>,
    listener: () => void,
    componentName: string = 'react component',
    listenerKind: SubscriptionListenerKind = 'render',
  ): () => void {
    if (this.phase === 'settling') {
      throw new Error('[reflex] Subscribing during subscription computation is not allowed.');
    }
    const subscription = this.unwrap(node);
    if (subscription.disposed) {
      throw new Error(
        `[reflex] Subscription ${subscription.spec.key} was disposed; reacquire it by key.`,
      );
    }
    const firstListener = subscription.listeners.length === 0;
    const registration: SubscriptionListenerRegistration = [listener, componentName, listenerKind];
    subscription.listeners.push(registration);
    try {
      this.activate(subscription);
      if (firstListener) this.pull(subscription, false);
    } catch (error) {
      const listenerIndex = subscription.listeners.indexOf(registration);
      if (listenerIndex !== -1) subscription.listeners.splice(listenerIndex, 1);
      this.releaseUnused(subscription);
      throw error;
    }

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.unsubscribe(subscription, registration);
    };
  }

  publish(
    roots: SubscriptionNode<any>[],
    includeDiagnostics: boolean = false,
  ): readonly RuntimeProbeSubscription[] {
    this.assertPublicationAllowed();
    const subscriptions = roots.map((root) => this.unwrap(root));
    const nonRoot = subscriptions.find((subscription) => subscription.spec.kind !== 'root');
    if (nonRoot)
      throw new Error(`[reflex] Cannot publish non-root subscription ${nonRoot.spec.key}.`);
    return this.publishWave(Array.from(new Set(subscriptions)), includeDiagnostics);
  }

  assertPublicationAllowed(): void {
    if (this.phase !== 'idle') {
      throw new Error(
        '[reflex] Subscription publication is not allowed during computation or listener delivery.',
      );
    }
  }

  assertClearAllowed(): void {
    if (this.activeNodes > 0) {
      throw new Error('[reflex] Cannot clear subscriptions while a subscription graph is active.');
    }
  }

  nextOutputStamp(): number {
    return ++this.outputStamp;
  }

  inspect(node: SubscriptionNode<any>): SubscriptionDiagnostic {
    const subscription = this.unwrap(node);
    const status = subscription.hasError ? 'error' : subscription.hasValue ? 'value' : 'empty';
    return {
      key: subscription.spec.key,
      query: [...subscription.spec.query] as SubVector,
      kind: subscription.spec.kind,
      active: subscription.active,
      version: subscription.outputStamp,
      status,
      ...(status === 'value' ? { value: subscription.value } : {}),
      ...(status === 'error' ? { error: formatDiagnosticError(subscription.error) } : {}),
    };
  }

  unwrap<T>(node: SubscriptionNode<T>): SubscriptionCell<T> {
    if (!(node instanceof SubscriptionCell) || node.engine !== this) {
      throw new Error('[reflex] Subscription belongs to a different runtime.');
    }
    return node;
  }

  /** Validate a dormant graph dependency-first without recursive call depth. */
  private pull(target: SubscriptionCell<any>, retryErrors: boolean): void {
    const epoch = ++this.pullEpoch;
    const stack: Array<[SubscriptionCell<any>, boolean]> = [[target, false]];
    const previousPhase = this.phase;
    this.phase = 'settling';

    try {
      while (stack.length > 0) {
        const [subscription, expanded] = stack.pop()!;
        if (!expanded) {
          if (subscription.lastPullEpoch === epoch) continue;
          subscription.lastPullEpoch = epoch;
          if (
            subscription.active &&
            subscription.initialized &&
            subscription.validatedEpoch === this.publicationEpoch &&
            !(retryErrors && subscription.hasError)
          )
            continue;
          stack.push([subscription, true]);
          for (let index = subscription.dependencies.length - 1; index >= 0; index--) {
            stack.push([subscription.dependencies[index]!, false]);
          }
          continue;
        }

        if (subscription.spec.kind === 'root') {
          if (!subscription.initialized || (retryErrors && subscription.hasError))
            subscription.refreshRoot();
        } else {
          subscription.refreshComputed(retryErrors && subscription.hasError);
        }
        subscription.validatedEpoch = this.publicationEpoch;
      }
    } finally {
      this.phase = previousPhase;
    }
  }

  /** Push changed roots through active dependents in topological-rank order. */
  private publishWave(
    roots: SubscriptionCell<any>[],
    includeDiagnostics: boolean,
  ): readonly RuntimeProbeSubscription[] {
    const wave = ++this.wave;
    this.publicationEpoch++;
    const buckets = new Map<number, SubscriptionCell<any>[]>();
    const ranks: number[] = [];
    let rankIndex = -1;
    const changed: SubscriptionCell<any>[] = [];
    const recalculated = includeDiagnostics ? ([] as SubscriptionCell<any>[]) : undefined;

    const enqueue = (subscription: SubscriptionCell<any>) => {
      if (!subscription.active || subscription.queuedWave === wave) return;
      subscription.queuedWave = wave;
      const rank = subscription.rank;
      const bucket = buckets.get(rank);
      if (bucket) {
        bucket.push(subscription);
        return;
      }
      buckets.set(rank, [subscription]);
      if (rankIndex < 0) {
        ranks.push(rank);
        return;
      }
      let low = rankIndex + 1;
      let high = ranks.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (ranks[middle]! < rank) low = middle + 1;
        else high = middle;
      }
      ranks.splice(low, 0, rank);
    };

    this.phase = 'settling';
    try {
      for (const root of roots) {
        root.validatedEpoch = this.publicationEpoch;
        const changedRoot = root.refreshRoot();
        recalculated?.push(root);
        if (changedRoot) {
          if (root.listeners.length > 0) changed.push(root);
          for (const dependent of root.dependents) enqueue(dependent);
        }
      }

      ranks.sort((left, right) => left - right);
      for (rankIndex = 0; rankIndex < ranks.length; rankIndex++) {
        const bucket = buckets.get(ranks[rankIndex]!);
        if (!bucket) continue;
        for (const subscription of bucket) {
          subscription.validatedEpoch = this.publicationEpoch;
          if (!subscription.active) continue;
          const changedSubscription = subscription.refreshComputed(false);
          // A cell enters a publication bucket only after an upstream
          // observable change, so this refresh evaluates (or propagates an
          // upstream error) even if its own result compares equal.
          recalculated?.push(subscription);
          if (!changedSubscription) continue;
          if (subscription.listeners.length > 0) changed.push(subscription);
          for (const dependent of subscription.dependents) enqueue(dependent);
        }
      }

      // Freeze every listener list before delivering the first callback. All
      // snapshots therefore expose one fully-settled STATE generation.
      const plans = changed.map((subscription) => ({
        subscription,
        listeners: subscription.listeners.slice(),
      }));
      this.phase = 'notifying';
      for (const plan of plans) plan.subscription.publishTo(plan.listeners);
    } finally {
      this.phase = 'idle';
      this.drainDeferredReleases();
    }
    return includeDiagnostics
      ? recalculated!.map((subscription) => this.snapshotRecalculated(subscription))
      : NO_RECALCULATED_SUBSCRIPTIONS;
  }

  private snapshotRecalculated(subscription: SubscriptionCell<any>): RuntimeProbeSubscription {
    return {
      key: subscription.spec.key,
      query: [...subscription.spec.query] as SubVector,
      kind: subscription.spec.kind,
      active: subscription.active,
      version: subscription.outputStamp,
      status: subscription.hasError ? 'error' : 'value',
      ...(subscription.hasError
        ? { error: formatDiagnosticError(subscription.error) }
        : { value: subscription.value }),
    };
  }

  /** Activate dependencies before dependents and roll back atomically on error. */
  private activate(target: SubscriptionCell<any>): void {
    if (target.active) return;
    const stack: Array<[SubscriptionCell<any>, boolean]> = [[target, false]];
    const activated: SubscriptionCell<any>[] = [];

    try {
      while (stack.length > 0) {
        const [subscription, expanded] = stack.pop()!;
        if (subscription.active) continue;
        if (subscription.disposed) {
          throw new Error(`[reflex] Dependency ${subscription.spec.key} was already disposed.`);
        }
        if (!expanded) {
          stack.push([subscription, true]);
          for (const dependency of subscription.uniqueDependencies) {
            if (!dependency.active) stack.push([dependency, false]);
          }
          continue;
        }

        subscription.active = true;
        this.activeNodes++;
        for (const dependency of subscription.uniqueDependencies) {
          dependency.dependents.add(subscription);
        }
        activated.push(subscription);
        subscription.spec.onActive();
      }
    } catch (error) {
      for (let index = activated.length - 1; index >= 0; index--) {
        const subscription = activated[index]!;
        subscription.active = false;
        this.activeNodes--;
        for (const dependency of subscription.uniqueDependencies) {
          dependency.dependents.delete(subscription);
        }
        this.callOnUnused(subscription);
      }
      throw error;
    }
  }

  private unsubscribe(
    subscription: SubscriptionCell<any>,
    registration: SubscriptionListenerRegistration,
  ): void {
    const index = subscription.listeners.indexOf(registration);
    if (index === -1) return;
    subscription.listeners.splice(index, 1);
    if (this.phase === 'notifying') {
      this.deferredReleases.add(subscription);
      return;
    }
    this.releaseUnused(subscription);
  }

  /** Release an unused branch toward its dependencies; computed cells are terminal. */
  private releaseUnused(target: SubscriptionCell<any>): void {
    const stack = [target];
    while (stack.length > 0) {
      const subscription = stack.pop()!;
      if (
        !subscription.active ||
        subscription.listeners.length > 0 ||
        subscription.dependents.size > 0
      )
        continue;

      subscription.active = false;
      this.activeNodes--;
      subscription.traceDispose();
      for (const dependency of subscription.uniqueDependencies) {
        dependency.dependents.delete(subscription);
        stack.push(dependency);
      }
      if (subscription.spec.kind === 'computed') subscription.disposed = true;
      this.callOnUnused(subscription);
    }
  }

  private drainDeferredReleases(): void {
    if (this.deferredReleases.size === 0) return;
    const releases = Array.from(this.deferredReleases);
    this.deferredReleases.clear();
    for (const subscription of releases) this.releaseUnused(subscription);
  }

  private callOnUnused(subscription: SubscriptionCell<any>): void {
    try {
      subscription.spec.onUnused();
    } catch (error) {
      consoleLog('error', '[reflex] Error releasing subscription:', error);
    }
  }
}
