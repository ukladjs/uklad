import { consoleLog } from '../../core/logging';
import { SubscriptionCell } from './cell';
import { ExternalSubscriptionCoordinator } from './external/coordinator';
import { type RuntimeCore } from '../core';

import type { SubVector } from '../../types';
import type { RuntimeProbeSubscription } from '../probe-types';
import type {
  SubscriptionDiagnostic,
  SubscriptionListenerKind,
  SubscriptionListenerRegistration,
  SubscriptionNode,
  SubscriptionSpec,
} from './types';

export type {
  ExternalSubscriptionContext,
  ExternalSubscriptionDriver,
  SubscriptionDiagnostic,
  SubscriptionKind,
  SubscriptionListenerKind,
  SubscriptionNode,
  SubscriptionSpec,
} from './types';

const NO_RECALCULATED_SUBSCRIPTIONS: readonly RuntimeProbeSubscription[] = Object.freeze([]);

/**
 * Owns the lifecycle of opaque subscription cells.
 *
 * Active graphs settle in topological order when STATE roots are published. Dormant
 * graphs are validated lazily by a memoized pull. STATE publication is already the
 * scheduler for state-backed graphs; external coordination is delegated to a lazy companion.
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
  /** Created only when the runtime actually constructs an external graph. */
  private external: ExternalSubscriptionCoordinator | undefined;

  create<T>(spec: SubscriptionSpec<T>): SubscriptionNode<T> {
    if (this.phase === 'settling') {
      throw new Error(
        '[uklad] Creating subscriptions during subscription computation is not allowed.',
      );
    }
    if (spec.kind === 'root' && spec.dependencies.length !== 0) {
      throw new Error(`[uklad] Root subscription ${spec.key} cannot have dependencies.`);
    }
    if (spec.kind === 'external' && spec.external === undefined) {
      throw new Error(`[uklad] External subscription ${spec.key} must provide a driver.`);
    }
    if (spec.kind !== 'external' && spec.external !== undefined) {
      throw new Error(`[uklad] Only external subscriptions may provide a driver.`);
    }
    const cell = new SubscriptionCell(this, spec) as unknown as SubscriptionCell<T>;
    if (spec.kind === 'external' || this.external !== undefined)
      this.getExternalCoordinator().track(cell as SubscriptionCell<any>);
    return cell as unknown as SubscriptionNode<T>;
  }

  read<T>(node: SubscriptionNode<T>): T {
    return this.getSnapshot(node);
  }

  getSnapshot<T>(node: SubscriptionNode<T>): T {
    if (this.phase === 'settling') {
      throw new Error(
        '[uklad] Subscription reads are not allowed during subscription computation.',
      );
    }
    const subscription = this.unwrap(node);
    if (subscription.disposed) {
      throw new Error(
        `[uklad] Subscription ${subscription.spec.key} was disposed; reacquire it by key.`,
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
      throw new Error('[uklad] Subscribing during subscription computation is not allowed.');
    }
    const subscription = this.unwrap(node);
    if (subscription.disposed) {
      throw new Error(
        `[uklad] Subscription ${subscription.spec.key} was disposed; reacquire it by key.`,
      );
    }
    const firstListener = subscription.listeners.length === 0;
    const registration: SubscriptionListenerRegistration = [listener, componentName, listenerKind];
    subscription.listeners.push(registration);
    const hasExternalGraph = firstListener && this.external?.hasGraph(subscription) === true;
    try {
      // External sources need their dependency tuple before activation. Keep
      // ordinary subscriptions on the original activate-then-pull path.
      if (hasExternalGraph) this.pull(subscription, false);
      this.activate(subscription);
      if (firstListener) {
        // A dormant render may have read an external snapshot before commit.
        // Re-read only the external subgraph after `activate()` so a cache
        // change between render and commit is visible to getSnapshot().
        this.pull(subscription, false, hasExternalGraph);
      }
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
      throw new Error(`[uklad] Cannot publish non-root subscription ${nonRoot.spec.key}.`);
    const recalculated = this.publishWave(Array.from(new Set(subscriptions)), includeDiagnostics);
    this.external?.drain();
    return recalculated;
  }

  assertPublicationAllowed(): void {
    if (this.phase !== 'idle') {
      throw new Error(
        '[uklad] Subscription publication is not allowed during computation or listener delivery.',
      );
    }
  }

  assertClearAllowed(): void {
    if (this.activeNodes > 0) {
      throw new Error('[uklad] Cannot clear subscriptions while a subscription graph is active.');
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
      throw new Error('[uklad] Subscription belongs to a different runtime.');
    }
    return node;
  }

  /** @internal Terminalize external resources for a node removed from the cache. */
  disposeNode(node: SubscriptionNode<any>): void {
    const subscription = this.unwrap(node);
    // HMR may remove a cached node before its old consumer unsubscribes. The
    // coordinator terminalizes external resources while graph bookkeeping stays intact.
    this.external?.disposeNode(subscription);
  }

  /** Validate a dormant graph dependency-first without recursive call depth. */
  private pull(
    target: SubscriptionCell<any>,
    retryErrors: boolean,
    forceExternalSources: boolean = false,
  ): void {
    const epoch = ++this.pullEpoch;
    const stack: Array<[SubscriptionCell<any>, boolean]> = [[target, false]];
    const previousPhase = this.phase;
    this.phase = 'settling';

    try {
      while (stack.length > 0) {
        const [subscription, expanded] = stack.pop()!;
        const visitExternalGraph =
          forceExternalSources && this.external?.hasGraph(subscription) === true;
        const forceExternalRead = forceExternalSources && subscription.spec.kind === 'external';
        if (!expanded) {
          if (subscription.lastPullEpoch === epoch) continue;
          if (subscription.disposed) {
            throw new Error(
              `[uklad] Dependency ${subscription.spec.key} was disposed; reacquire the graph by key.`,
            );
          }
          subscription.lastPullEpoch = epoch;
          const canSkip =
            subscription.active &&
            subscription.initialized &&
            subscription.validatedEpoch === this.publicationEpoch &&
            !(retryErrors && subscription.hasError);
          if (canSkip && !visitExternalGraph) continue;
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
          subscription.refreshComputed(forceExternalRead || (retryErrors && subscription.hasError));
          this.external?.syncIfNeeded(subscription);
        }
        subscription.validatedEpoch = this.publicationEpoch;
      }
    } finally {
      this.phase = previousPhase;
      if (previousPhase === 'idle') this.external?.drain();
    }
  }

  /** Push changed roots through active dependents in topological-rank order. */
  private publishWave(
    roots: SubscriptionCell<any>[],
    includeDiagnostics: boolean,
    forceExternalRoots: boolean = false,
  ): readonly RuntimeProbeSubscription[] {
    const wave = ++this.wave;
    this.publicationEpoch++;
    const buckets = new Map<number, SubscriptionCell<any>[]>();
    const ranks: number[] = [];
    let rankIndex = -1;
    const changed: SubscriptionCell<any>[] = [];
    const recalculated = includeDiagnostics ? ([] as SubscriptionCell<any>[]) : undefined;
    const externalWave = this.external?.beginWave();
    const forcedExternalRoots = forceExternalRoots ? new Set(roots) : undefined;

    const enqueue = (subscription: SubscriptionCell<any>) => {
      if (!subscription.active || subscription.disposed || subscription.queuedWave === wave) return;
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
      if (forcedExternalRoots !== undefined) {
        // Invalidated external sources may depend on graph work triggered by
        // another source in the same batch. Queue all of them by rank so any
        // intervening computed nodes settle before their external dependents.
        for (const root of roots) enqueue(root);
      } else {
        for (const root of roots) {
          root.validatedEpoch = this.publicationEpoch;
          const changedRoot = root.refreshRoot();
          recalculated?.push(root);
          if (changedRoot) {
            if (root.listeners.length > 0) changed.push(root);
            for (const dependent of root.dependents) enqueue(dependent);
          }
        }
      }

      ranks.sort((left, right) => left - right);
      for (rankIndex = 0; rankIndex < ranks.length; rankIndex++) {
        const bucket = buckets.get(ranks[rankIndex]!);
        if (!bucket) continue;
        for (const subscription of bucket) {
          subscription.validatedEpoch = this.publicationEpoch;
          if (!subscription.active) continue;
          const changedSubscription = subscription.refreshComputed(
            forcedExternalRoots?.has(subscription) === true,
          );
          // A cell enters a publication bucket only after an upstream
          // observable change, so this refresh evaluates (or propagates an
          // upstream error) even if its own result compares equal.
          externalWave?.record(subscription);
          recalculated?.push(subscription);
          if (!changedSubscription) continue;
          if (subscription.listeners.length > 0) changed.push(subscription);
          for (const dependent of subscription.dependents) enqueue(dependent);
        }
      }

      // Driver synchronization is an imperative reconciliation step. Run it
      // only after every ordinary graph computation has settled, but before
      // listener plans are frozen. A sync failure becomes a source error and
      // is propagated through active dependents before any callback runs.
      const syncFailures = externalWave?.finish();

      if (syncFailures !== undefined && syncFailures.length > 0) {
        // The main wave is single-visit. Only the exceptional second pass can
        // revisit cells, so allocate the dedupe sets on that rare path.
        const changedSet = new Set(changed);
        const recalculatedSet = recalculated === undefined ? undefined : new Set(recalculated);
        const recordChanged = (subscription: SubscriptionCell<any>): void => {
          if (subscription.listeners.length === 0 || changedSet.has(subscription)) return;
          changedSet.add(subscription);
          changed.push(subscription);
        };
        const recordRecalculated = (subscription: SubscriptionCell<any>): void => {
          if (recalculated === undefined || recalculatedSet?.has(subscription)) return;
          recalculatedSet?.add(subscription);
          recalculated.push(subscription);
        };
        for (const failed of syncFailures) recordChanged(failed);
        const pending = new Set<SubscriptionCell<any>>();
        for (const failed of syncFailures) {
          for (const dependent of failed.dependents) pending.add(dependent);
        }
        while (pending.size > 0) {
          const [subscription] = Array.from(pending).sort((left, right) => left.rank - right.rank);
          pending.delete(subscription!);
          if (!subscription!.active) continue;
          const settled = subscription!.refreshComputed(false);
          recordRecalculated(subscription!);
          if (!settled) continue;
          recordChanged(subscription!);
          for (const dependent of subscription!.dependents) pending.add(dependent);
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
          throw new Error(`[uklad] Dependency ${subscription.spec.key} was already disposed.`);
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
        this.external?.activate(subscription);
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
        this.external?.removePending(subscription);
        this.external?.dispose(subscription);
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
      this.external?.removePending(subscription);
      subscription.traceDispose();
      for (const dependency of subscription.uniqueDependencies) {
        dependency.dependents.delete(subscription);
        stack.push(dependency);
      }
      if (subscription.spec.kind === 'computed' || subscription.spec.kind === 'external') {
        subscription.disposed = true;
      }
      this.external?.dispose(subscription);
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
      consoleLog('error', '[uklad] Error releasing subscription:', error);
    }
  }

  private getExternalCoordinator(): ExternalSubscriptionCoordinator {
    if (this.external !== undefined) return this.external;
    const external = new ExternalSubscriptionCoordinator({
      getRuntime: this.getRuntime,
      getPhase: () => this.phase,
      withSettling: (callback) => this.withSettling(callback),
      publishExternalWave: (roots) => this.publishWave(roots, false, true),
    });
    this.external = external;
    return external;
  }

  private withSettling<T>(callback: () => T): T {
    const previousPhase = this.phase;
    this.phase = 'settling';
    try {
      return callback();
    } finally {
      this.phase = previousPhase;
    }
  }
}

function formatDiagnosticError(error: unknown): string {
  try {
    return error instanceof Error ? String(error.message) : String(error);
  } catch {
    return '[Unprintable subscription error]';
  }
}
