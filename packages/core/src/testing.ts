/**
 * Test-only runtime adapters.
 *
 * This entrypoint deliberately exposes focused operations instead of the live
 * handler registry. Production applications should not import it.
 */
import { getRuntimeAdminForTests } from './runtime/runtime';

import type {
  ContractCoeffectId,
  ContractEffectParams,
  ContractDispatchVector,
  ContractState,
  ContractSubscribeVector,
  ContractSubscriptionId,
  ContractSubscriptionParams,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  UkladDisposer,
  PermissiveUkladContracts,
  UkladContracts,
  WatchSubscriptionOptions,
} from './contracts';
import type {
  UkladRuntime,
  RuntimeCoeffectHandler,
  RuntimeEventHandler,
  RuntimeSubscriptionHandler,
} from './runtime/api';
import type { SubDepsHandler } from './types';

export interface UkladTestHarness<TContracts extends UkladContracts = PermissiveUkladContracts> {
  getState(): ContractState<TContracts>;
  flush(): Promise<void>;
  dispatchSync(event: ContractDispatchVector<TContracts>): void;
  restoreState(nextState: ContractState<TContracts>): void;
  getEventHandler<TId extends string>(id: TId): RuntimeEventHandler<TContracts, TId> | undefined;
  getEffectHandler<TId extends string>(
    id: TId,
  ): ((value: ContractEffectParams<TContracts, TId>) => void) | undefined;
  getCoeffectHandler<TId extends ContractCoeffectId<TContracts>>(
    id: TId,
  ): RuntimeCoeffectHandler<TContracts, TId> | undefined;
  getSubscriptionHandler<TId extends ContractSubscriptionId<TContracts>>(
    id: TId,
  ): RuntimeSubscriptionHandler<TContracts, TId> | undefined;
  getSubscriptionDependencies<TId extends ContractSubscriptionId<TContracts>>(
    id: TId,
  ):
    | ((
        ...params: ContractSubscriptionParams<TContracts, TId>
      ) => ContractSubscribeVector<TContracts>[])
    | undefined;
  getSubscriptionValue<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
  ): ContractSubscriptionResult<TContracts, TId>;
  watchSubscription<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
    listener: (
      value: ContractSubscriptionResult<TContracts, TId>,
      previous?: ContractSubscriptionResult<TContracts, TId>,
    ) => void,
    options?: WatchSubscriptionOptions,
  ): UkladDisposer;
}

/** A named collection of subscriptions observed by one headless view. */
export type UkladHeadlessViewQueries<TContracts extends UkladContracts> = Readonly<
  Record<string, ContractSubscribeVector<TContracts>>
>;

/** The result type produced by one query in a headless view declaration. */
export type UkladHeadlessViewValue<
  TContracts extends UkladContracts,
  TQuery,
> = TQuery extends readonly [infer TId, ...unknown[]]
  ? TId extends ContractSubscriptionId<TContracts>
    ? ContractSubscriptionResult<TContracts, TId>
    : never
  : never;

/** Latest published values observed by a mounted headless view. */
export type UkladHeadlessViewValues<
  TContracts extends UkladContracts,
  TQueries extends UkladHeadlessViewQueries<TContracts>,
> = {
  readonly [TKey in keyof TQueries]: UkladHeadlessViewValue<TContracts, TQueries[TKey]>;
};

/** One value delivery to a mounted headless view. */
export interface UkladHeadlessViewUpdate<TValue> {
  readonly value: TValue;
  readonly previousValue: TValue | undefined;
}

/**
 * A browserless stand-in for one mounted view.
 *
 * It owns subscription watches only: it does not emulate React, the DOM, or
 * component-local state. Values are the subscription results actually
 * published while the view is mounted.
 */
export interface UkladHeadlessView<
  TContracts extends UkladContracts,
  TQueries extends UkladHeadlessViewQueries<TContracts>,
> {
  readonly name: string;
  readonly mounted: boolean;
  value<TKey extends Extract<keyof TQueries, string>>(
    key: TKey,
  ): UkladHeadlessViewValue<TContracts, TQueries[TKey]>;
  current(): UkladHeadlessViewValues<TContracts, TQueries>;
  history<TKey extends Extract<keyof TQueries, string>>(
    key: TKey,
  ): readonly UkladHeadlessViewUpdate<UkladHeadlessViewValue<TContracts, TQueries[TKey]>>[];
  /** Stop all watches owned by this view. Safe to call more than once. */
  unmount(): void;
}

/**
 * Browserless, application-semantic scenario controls.
 *
 * Scenarios deliberately expose the production `dispatch` boundary and
 * subscription-backed view observations. Direct state reads, restoration, and
 * synchronous dispatch remain available through `createUkladTestHarness` for
 * lower-level tests, but are not part of this E2E-facing surface.
 */
export interface UkladHeadlessScenario<
  TContracts extends UkladContracts = PermissiveUkladContracts,
> {
  dispatch(event: ContractDispatchVector<TContracts>): void;
  mountView<TQueries extends UkladHeadlessViewQueries<TContracts>>(
    name: string,
    queries: TQueries,
  ): UkladHeadlessView<TContracts, TQueries>;
  /** Wait for accepted Uklad work to finish and publish subscription results. */
  settle(): Promise<void>;
  /** Unmount all remaining views and dispose the runtime this scenario owns. */
  dispose(): Promise<void>;
}

/** Create a frozen, explicitly test-only view over one runtime owner. */
export function createUkladTestHarness<TContracts extends UkladContracts>(
  runtime: UkladRuntime<TContracts>,
): UkladTestHarness<TContracts> {
  const admin = getRuntimeAdminForTests(runtime);
  return Object.freeze({
    getState: admin.getState.bind(admin),
    flush: admin.flush.bind(admin),
    dispatchSync: admin.dispatchSync.bind(admin),
    restoreState: admin.restoreState.bind(admin),
    getEventHandler: (id: string) => admin.getHandlers().event[id],
    getEffectHandler: (id: string) => admin.getHandlers().fx[id],
    getCoeffectHandler: (id: string) => admin.getHandlers().cofx[id],
    getSubscriptionHandler: (id: string) => admin.getHandlers().sub[id],
    getSubscriptionDependencies: (id: string) => admin.getHandlers().subDeps[id],
    getSubscriptionValue: admin.getSubscriptionValue.bind(admin),
    watchSubscription: admin.watchSubscription.bind(admin),
  }) as UkladTestHarness<TContracts>;
}

/**
 * Create a browserless scenario over one isolated runtime.
 *
 * The scenario owns `runtime`: call `dispose()` in test teardown to release
 * mounted views and the runtime. `settle()` is intentionally limited to the
 * Uklad event queue and publication boundary. Headless platform adapters must
 * expose their own deterministic controls for network, clocks, or other async
 * work before the scenario is settled again.
 */
export function createUkladHeadlessScenario<TContracts extends UkladContracts>(
  runtime: UkladRuntime<TContracts>,
): UkladHeadlessScenario<TContracts> {
  const harness = createUkladTestHarness(runtime);
  const mountedViews = new Set<UkladDisposer>();
  let closing = false;
  let disposePromise: Promise<void> | undefined;

  const assertOpen = (): void => {
    if (closing) {
      throw new Error('[uklad] Headless scenario is disposed.');
    }
  };

  const dispatch = (event: ContractDispatchVector<TContracts>): void => {
    assertOpen();
    runtime.dispatch(event);
  };

  const settle = async (): Promise<void> => {
    assertOpen();
    await harness.flush();
  };

  const mountView = <TQueries extends UkladHeadlessViewQueries<TContracts>>(
    name: string,
    queries: TQueries,
  ): UkladHeadlessView<TContracts, TQueries> => {
    assertOpen();
    if (name.length === 0) {
      throw new TypeError('[uklad] Headless view name must be a non-empty string.');
    }

    type TKey = Extract<keyof TQueries, string>;
    const keys = Object.keys(queries) as TKey[];
    const values = new Map<TKey, unknown>();
    const histories = new Map<TKey, UkladHeadlessViewUpdate<unknown>[]>();
    const disposers: UkladDisposer[] = [];
    let mounted = true;

    const assertMounted = (): void => {
      if (!mounted) {
        throw new Error(`[uklad] Headless view '${name}' is unmounted.`);
      }
    };

    const unmount = (): void => {
      if (!mounted) return;
      mounted = false;
      mountedViews.delete(unmount);
      for (const dispose of disposers.reverse()) dispose();
    };

    try {
      for (const key of keys) {
        const history: UkladHeadlessViewUpdate<unknown>[] = [];
        histories.set(key, history);
        const query = queries[key] as ContractSubscribeVector<TContracts>;
        const dispose = harness.watchSubscription(
          query,
          (value, previousValue) => {
            values.set(key, value);
            history.push({ value, previousValue });
          },
          { label: `headless view ${name}.${key}` },
        );
        disposers.push(dispose);
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose();
      throw error;
    }

    mountedViews.add(unmount);

    return Object.freeze({
      name,
      get mounted(): boolean {
        return mounted;
      },
      value<TKey extends Extract<keyof TQueries, string>>(
        key: TKey,
      ): UkladHeadlessViewValue<TContracts, TQueries[TKey]> {
        assertMounted();
        return values.get(key as TKey) as UkladHeadlessViewValue<TContracts, TQueries[TKey]>;
      },
      current(): UkladHeadlessViewValues<TContracts, TQueries> {
        assertMounted();
        const snapshot: Record<string, unknown> = {};
        for (const key of keys) snapshot[key] = values.get(key);
        return Object.freeze(snapshot) as UkladHeadlessViewValues<TContracts, TQueries>;
      },
      history<TKey extends Extract<keyof TQueries, string>>(
        key: TKey,
      ): readonly UkladHeadlessViewUpdate<UkladHeadlessViewValue<TContracts, TQueries[TKey]>>[] {
        const history = histories.get(key as TKey);
        if (!history) {
          throw new Error(`[uklad] Unknown headless view query '${String(key)}'.`);
        }
        return Object.freeze([...history]) as readonly UkladHeadlessViewUpdate<
          UkladHeadlessViewValue<TContracts, TQueries[TKey]>
        >[];
      },
      unmount,
    }) as UkladHeadlessView<TContracts, TQueries>;
  };

  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;
    closing = true;
    disposePromise = (async () => {
      try {
        await harness.flush();
      } finally {
        for (const unmount of Array.from(mountedViews)) unmount();
        runtime.dispose();
      }
    })();
    return disposePromise;
  };

  return Object.freeze({ dispatch, mountView, settle, dispose });
}

export type { SubDepsHandler };
