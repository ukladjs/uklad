import { consoleLog } from '../../../core/logging';
import { withRuntimeProbeSpan } from '../../probe';

import type { RuntimeCore } from '../../core';
import type { SubVector } from '../../../types';
import type { SubscriptionCell } from '../cell';

type SubscriptionPhase = 'idle' | 'settling' | 'notifying';

interface ExternalSubscriptionHost {
  readonly getRuntime: () => RuntimeCore;
  readonly getPhase: () => SubscriptionPhase;
  readonly withSettling: <T>(callback: () => T) => T;
  readonly publishExternalWave: (roots: SubscriptionCell<any>[]) => void;
}

/** Coordinates external-only lifecycle and source invalidation concerns. */
export class ExternalSubscriptionCoordinator {
  private externalGraphs: WeakSet<SubscriptionCell<any>> | undefined;
  private pendingInvalidations: Set<SubscriptionCell<any>> | undefined;
  private draining = false;
  private readonly host: ExternalSubscriptionHost;

  constructor(host: ExternalSubscriptionHost) {
    this.host = host;
  }

  track(subscription: SubscriptionCell<any>): void {
    if (
      subscription.spec.kind === 'external' ||
      (this.externalGraphs !== undefined &&
        subscription.dependencies.some((dependency) => this.externalGraphs!.has(dependency)))
    ) {
      (this.externalGraphs ??= new WeakSet()).add(subscription);
    }
  }

  hasGraph(subscription: SubscriptionCell<any>): boolean {
    return this.externalGraphs?.has(subscription) === true;
  }

  invalidate(subscription: SubscriptionCell<any>): void {
    if (subscription.spec.kind !== 'external' || !subscription.active || subscription.disposed) {
      return;
    }
    (this.pendingInvalidations ??= new Set()).add(subscription);
    if (this.host.getPhase() === 'idle') this.drain();
  }

  drain(): void {
    if (
      this.host.getPhase() !== 'idle' ||
      this.draining ||
      this.pendingInvalidations === undefined ||
      this.pendingInvalidations.size === 0
    )
      return;

    this.draining = true;
    try {
      while (this.pendingInvalidations !== undefined && this.pendingInvalidations.size > 0) {
        const pending = Array.from(this.pendingInvalidations);
        this.pendingInvalidations.clear();
        const active = pending
          .filter((subscription) => subscription.active && !subscription.disposed)
          .sort((left, right) => left.rank - right.rank);
        if (active.length === 0) continue;

        const query = active.length === 1 ? active[0]!.spec.query : (['external'] as SubVector);
        withRuntimeProbeSpan(
          this.host.getRuntime(),
          () => ({
            operation: String(query[0]),
            opType: 'sub/ext',
            tags: {
              queryV: query,
              subscriptionKeys: active.map((subscription) => subscription.spec.key),
            },
          }),
          () => this.host.publishExternalWave(active),
        );
      }
    } finally {
      this.draining = false;
    }
  }

  beginWave(): ExternalSubscriptionWave {
    return new ExternalSubscriptionWave(this);
  }

  activate(subscription: SubscriptionCell<any>): void {
    if (subscription.spec.kind !== 'external') return;
    this.host.withSettling(() =>
      subscription.activateExternal(() => this.invalidate(subscription)),
    );
  }

  syncIfNeeded(subscription: SubscriptionCell<any>): void {
    this.sync(subscription);
  }

  sync(subscription: SubscriptionCell<any>): boolean {
    if (
      subscription.spec.kind !== 'external' ||
      !subscription.active ||
      subscription.disposed ||
      !subscription.needsExternalSync()
    )
      return false;

    try {
      subscription.syncExternal();
    } catch (error) {
      consoleLog(
        'error',
        `[uklad] Error synchronizing external subscription ${subscription.spec.key}:`,
        error,
      );
      return subscription.retainExternalError(error);
    }
    return false;
  }

  removePending(subscription: SubscriptionCell<any>): void {
    this.pendingInvalidations?.delete(subscription);
  }

  disposeNode(subscription: SubscriptionCell<any>): void {
    this.removePending(subscription);
    if (subscription.spec.kind !== 'external') return;
    subscription.disposed = true;
    this.dispose(subscription);
  }

  dispose(subscription: SubscriptionCell<any>): void {
    if (subscription.spec.kind !== 'external') return;
    try {
      subscription.disposeExternal();
    } catch (error) {
      consoleLog('error', '[uklad] Error disposing external subscription:', error);
    }
  }
}

class ExternalSubscriptionWave {
  private syncs: SubscriptionCell<any>[] | undefined;
  private readonly coordinator: ExternalSubscriptionCoordinator;

  constructor(coordinator: ExternalSubscriptionCoordinator) {
    this.coordinator = coordinator;
  }

  record(subscription: SubscriptionCell<any>): void {
    if (
      subscription.spec.kind !== 'external' ||
      !subscription.active ||
      !subscription.needsExternalSync()
    )
      return;
    (this.syncs ??= []).push(subscription);
  }

  finish(): SubscriptionCell<any>[] | undefined {
    if (this.syncs === undefined) return undefined;
    let failures: SubscriptionCell<any>[] | undefined;
    for (const subscription of this.syncs) {
      if (this.coordinator.sync(subscription)) {
        (failures ??= []).push(subscription);
      }
    }
    return failures;
  }
}
