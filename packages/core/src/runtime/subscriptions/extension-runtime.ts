import { consoleLog } from '../../core/logging';
import { scheduleNextTick } from '../../core/scheduling';
import { isRuntimeDisposed, type RuntimeCore } from '../core';
import { createRegistrationHandle, RegistrationCollisionError } from '../registrations';

import type { RegistrationHandle } from '../registrations';
import type {
  Id,
  SubscriptionExtension,
  SubscriptionExtensionContext,
  SubscriptionRootUpdater,
  SubVector,
} from '../../types';

const SUBSCRIPTION_EXTENSION_EVENT_ID = '__ukladjs/sub-extension/update';

interface ExtensionDefinition {
  readonly signals: (...params: any[]) => SubVector[];
  readonly createExtension: (
    context: SubscriptionExtensionContext,
    ...params: any[]
  ) => SubscriptionExtension<any>;
  readonly token: symbol;
}

interface ExtensionActivation {
  active: boolean;
  scheduleSync: () => void;
}

interface ExtensionStateUpdate {
  readonly stateKey: string;
}

interface ExtensionStateAuthorization {
  readonly stateKey: string;
  readonly updater: SubscriptionRootUpdater<any>;
  readonly activation: ExtensionActivation;
}

/** Extension definition and parameters retained by one subscription instance. */
export interface SubscriptionExtensionPlan {
  readonly id: Id;
  readonly params: readonly unknown[];
  readonly token: symbol;
  readonly signals: ExtensionDefinition['signals'];
  readonly createExtension: ExtensionDefinition['createExtension'];
}

interface ExtensionHost {
  getRuntime(): RuntimeCore;
  hasRoot(stateKey: string): boolean;
  hasCachedId(subId: Id): boolean;
  assertDefinitionCanBeCleared(subId: Id): void;
  readSignal(query: SubVector): unknown;
}

/**
 * Runtime-private registry and activation host for `regSubExt`.
 *
 * The protected STATE bridge is installed lazily on the first registration.
 * Active instances re-read their signal tuple after STATE publications. Those
 * reads never register render/watch listeners or keep sampled graphs active.
 */
export class SubscriptionExtensionRuntime {
  private readonly definitions: Map<Id, ExtensionDefinition> = new Map();
  private readonly activations: Set<ExtensionActivation> = new Set();
  private readonly stateUpdates: WeakMap<object, ExtensionStateAuthorization> = new WeakMap();
  private readonly host: ExtensionHost;
  private updateEventRegistration: RegistrationHandle | undefined;

  constructor(host: ExtensionHost) {
    this.host = host;
  }

  register(
    id: Id,
    signals: (...params: any[]) => SubVector[],
    createExtension: (
      context: SubscriptionExtensionContext,
      ...params: any[]
    ) => SubscriptionExtension<any>,
  ): RegistrationHandle | undefined {
    const runtime = this.host.getRuntime();
    if (!runtime.registry.sub.has(id)) {
      consoleLog(
        'error',
        `[uklad] Cannot attach an extension to '${id}' before registering that subscription.`,
      );
      return undefined;
    }
    if (typeof signals !== 'function' || typeof createExtension !== 'function') {
      consoleLog(
        'error',
        `[uklad] Subscription extension '${id}' must specify signals and createExtension.`,
      );
      return undefined;
    }
    if (this.definitions.has(id)) throw new RegistrationCollisionError(id);
    if (this.host.hasCachedId(id)) {
      throw new Error(
        `[uklad] Cannot attach an extension to '${id}' while a cached query for that id exists. Register extensions before creating subscription instances.`,
      );
    }
    this.ensureBridge();
    const token = Symbol(String(id));
    this.definitions.set(id, { signals, createExtension, token });
    const isActive = () => this.definitions.get(id)?.token === token;
    const assertReleasable = (): void => {
      if (isActive()) this.host.assertDefinitionCanBeCleared(id);
    };
    return createRegistrationHandle({
      isActive,
      assertReleasable,
      release: () => {
        if (!isActive()) return false;
        this.host.assertDefinitionCanBeCleared(id);
        this.clear(id);
        return true;
      },
    });
  }

  getPlan(id: Id, params: readonly unknown[]): SubscriptionExtensionPlan | undefined {
    const definition = this.definitions.get(id);
    if (definition === undefined) return undefined;
    return {
      id,
      params,
      token: definition.token,
      signals: definition.signals,
      createExtension: definition.createExtension,
    };
  }

  activate(plan: SubscriptionExtensionPlan): (() => void) | undefined {
    if (this.definitions.get(plan.id)?.token !== plan.token) return undefined;

    const signalVectors = plan.signals(...(plan.params as any[]));
    if (!Array.isArray(signalVectors)) {
      throw new Error(
        `[uklad] Subscription extension '${plan.id}' signal handler must return an array.`,
      );
    }
    for (const vector of signalVectors) {
      if (!Array.isArray(vector) || typeof vector[0] !== 'string') {
        throw new Error(
          `[uklad] Subscription extension '${plan.id}' returned an invalid signal vector.`,
        );
      }
    }

    const activation: ExtensionActivation = { active: true, scheduleSync: () => {} };
    const context: SubscriptionExtensionContext = {
      updateRoot: (stateKey, updater) => {
        if (!activation.active) return;
        if (typeof updater !== 'function') {
          throw new TypeError(
            `[uklad] Subscription extension '${plan.id}' root updater must be a function.`,
          );
        }
        if (!this.host.hasRoot(stateKey)) {
          throw new Error(
            `[uklad] Subscription extension '${plan.id}' cannot update state key '${stateKey}' because no root subscription uses it.`,
          );
        }
        this.enqueueStateUpdate(stateKey, updater, activation);
      },
    };

    let candidate: unknown;
    try {
      candidate = plan.createExtension(context, ...(plan.params as any[]));
    } catch (error) {
      activation.active = false;
      throw error;
    }
    if (!isSubscriptionExtension(candidate)) {
      activation.active = false;
      throw new Error(
        `[uklad] Subscription extension '${plan.id}' must return an object with sync() and dispose().`,
      );
    }

    const extension = candidate;
    let previousSignalValues: readonly unknown[] | undefined;
    let syncScheduled = false;

    const sync = (force: boolean): void => {
      if (!activation.active || isRuntimeDisposed(this.host.getRuntime())) return;
      try {
        const signalValues = signalVectors.map((query) => this.host.readSignal(query));
        if (!force && signalValuesEqual(previousSignalValues, signalValues)) return;
        previousSignalValues = signalValues;
        extension.sync(signalValues);
      } catch (error) {
        consoleLog(
          'error',
          `[uklad] Error synchronizing subscription extension '${plan.id}':`,
          error,
        );
      }
    };

    const dispose = (): void => {
      if (!activation.active) return;
      activation.active = false;
      this.activations.delete(activation);
      extension.dispose();
    };

    const scheduleSync = (): void => {
      if (!activation.active || syncScheduled) return;
      syncScheduled = true;
      scheduleNextTick(() => {
        syncScheduled = false;
        sync(false);
      });
    };
    activation.scheduleSync = scheduleSync;

    try {
      // Activation is already caused by a real render/watch consumer, so the
      // first external binding can happen immediately. Later STATE publications
      // schedule one passive tuple check on the next host task.
      this.activations.add(activation);
      sync(true);
      return dispose;
    } catch (error) {
      try {
        dispose();
      } catch (disposeError) {
        consoleLog(
          'error',
          `[uklad] Error releasing subscription extension '${plan.id}' after failed activation:`,
          disposeError,
        );
      }
      throw error;
    }
  }

  notifyPublication(): void {
    for (const activation of this.activations) activation.scheduleSync();
  }

  clear(id: Id): void {
    this.definitions.delete(id);
  }

  clearAll(): void {
    this.definitions.clear();
  }

  private enqueueStateUpdate<TValue>(
    stateKey: string,
    updater: SubscriptionRootUpdater<TValue>,
    activation: ExtensionActivation,
  ): void {
    const update: ExtensionStateUpdate = { stateKey };
    this.stateUpdates.set(update, { stateKey, updater, activation });
    this.host.getRuntime().events.dispatchOwned([SUBSCRIPTION_EXTENSION_EVENT_ID, update]);
  }

  private ensureBridge(): void {
    const runtime = this.host.getRuntime();
    if (this.updateEventRegistration?.active !== true) {
      this.updateEventRegistration = runtime.events.registerEvent(
        SUBSCRIPTION_EXTENSION_EVENT_ID,
        ({ draftState }, update: ExtensionStateUpdate) => {
          const authorization =
            typeof update === 'object' && update !== null
              ? this.stateUpdates.get(update)
              : undefined;
          if (authorization?.activation.active !== true) return;
          const state = draftState as Record<string, unknown>;
          const current = state[authorization.stateKey];
          const next = authorization.updater(current);
          if (Object.is(current, next)) return;
          state[authorization.stateKey] = next;
        },
      );
    }
  }
}

function isSubscriptionExtension(value: unknown): value is SubscriptionExtension<any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SubscriptionExtension<any>).sync === 'function' &&
    typeof (value as SubscriptionExtension<any>).dispose === 'function'
  );
}

function signalValuesEqual(
  previous: readonly unknown[] | undefined,
  next: readonly unknown[],
): boolean {
  if (previous === undefined || previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index++) {
    if (!Object.is(previous[index], next[index])) return false;
  }
  return true;
}
