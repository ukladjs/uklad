import { scheduleAfterRender } from '../core/scheduling';
import { getCachedSubscription, getRootSubIdBySource } from './subscriptions/cache';
import {
  assertPublicationAllowed,
  publishSubscriptions,
  type SubscriptionNode,
} from './subscriptions/engine';
import { getRootSubKey } from './subscriptions/keys';

import type { Db, DefaultAppDb } from '../types';

// The live db: events read it (via produce) and commit new generations to it.
let appDb: any = {};
// The last flushed generation: everything render-facing (root subscription
// handlers, and therefore the whole subscription graph) reads this one. It only
// advances in flushSubscriptions, so between an event's commit and the next
// flush all subscriptions — alive caches and newly mounting components alike —
// serve one consistent db generation instead of a mixed-version window.
let renderDb: any = {};

let flushScheduled = false;

// Keeps T out of inference so the DefaultAppDb default applies: without it,
// T infers from `value` and an augmented AppDb would never be checked.
type NoInfer<T> = [T][T extends any ? 0 : never];

/**
 * Replace the app-db and synchronously publish changed roots to any surviving
 * subscription graph. Call this during bootstrap or an intentional app reset,
 * never from subscription evaluation or listener delivery.
 */
export function initAppDb<T = DefaultAppDb>(value: Db<NoInfer<T>>): void {
  assertPublicationAllowed();
  const oldDb = renderDb;
  appDb = value;
  renderDb = value;
  // Usually init runs before subscriptions exist. If it is deliberately used
  // to replace the DB while a graph survives (tests, app reset), publish the
  // changed roots now so active snapshots cannot retain the previous DB.
  publishSubscriptions(collectChangedRoots(oldDb, value));
}

/**
 * Return the latest committed app-db. This live write head can be ahead of the
 * generation visible to subscriptions until their scheduled flush completes.
 */
export function getAppDb<T = DefaultAppDb>(): Db<T> {
  return appDb as Db<T>;
}

/**
 * The db generation subscriptions read from. Internal: root subscription
 * handlers go through this so reads are consistent with the flush cycle.
 */
export function getRenderDb<T = DefaultAppDb>(): Db<T> {
  return renderDb as Db<T>;
}

/**
 * Commit a new db generation produced by an event handler and schedule the
 * subscription flush. Immer's structural sharing makes the change detection
 * here (and the per-key diff at flush time) a pure reference comparison:
 * untouched state keeps its identity, changed paths get fresh objects.
 */
export function updateAppDb<T = Record<string, any>>(newDb: Db<T>): void {
  if (newDb === appDb) {
    return;
  }
  appDb = newDb;
  if (!flushScheduled) {
    flushScheduled = true;
    scheduleAfterRender(() => {
      flushScheduled = false;
      flushSubscriptions();
    });
  }
}

/**
 * Promote the live db to the render generation and wake the root subscriptions
 * whose top-level key actually changed, found with a shallow reference diff
 * (`!Object.is(old[k], new[k])`). Consecutive events between two flushes coalesce into
 * a single diff against the previously flushed generation.
 *
 * Publication itself is synchronous. Ordinary dispatch reaches this function
 * from its scheduled DB flush; dispatchSync calls it inline.
 */
export function flushSubscriptions(): void {
  if (renderDb === appDb) {
    return;
  }
  assertPublicationAllowed();
  const oldDb = renderDb;
  const newDb = appDb;
  renderDb = newDb;

  publishSubscriptions(collectChangedRoots(oldDb, newDb));
}

function collectChangedRoots(oldDb: any, newDb: any): SubscriptionNode<any>[] {
  const dirtyRoots: SubscriptionNode<any>[] = [];
  const keys = new Set([...Object.keys(oldDb), ...Object.keys(newDb)]);
  for (const key of keys) {
    if (Object.is(oldDb[key], newDb[key])) {
      continue;
    }

    const subId = getRootSubIdBySource(key);
    if (subId === undefined) {
      continue;
    }

    const subscription = getCachedSubscription(getRootSubKey(subId));
    if (!subscription) {
      continue;
    }
    dirtyRoots.push(subscription);
  }

  return dirtyRoots;
}
