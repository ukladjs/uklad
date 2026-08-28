import { QueryObserver } from '@tanstack/query-core';

import type {
  DefaultedQueryObserverOptions,
  QueryClient,
  QueryKey,
  QueryObserverOptions,
} from '@tanstack/query-core';
import type {
  ContractSubscribeVector,
  ContractStateKey,
  ContractStateValue,
  ContractSubscriptionDependencyValues,
  ContractSubscriptionId,
  ContractSubscriptionParams,
  ContractSubscriptionResult,
  ContractSubscriptionSignalValues,
  EqualityCheckFn,
  SubConfig,
  SubscriptionExtension,
  UkladContracts,
  UkladRegistrar,
} from '@ukladjs/core/vanilla';
import type {
  ExternalSubscriptionContext,
  ExternalSubscriptionDriver,
} from '@ukladjs/core/vanilla';

import { assertAttachedQueryClient } from './lifecycle';
import { toQuerySnapshot } from './query-snapshot';

import type { QuerySnapshot } from './query-snapshot';

/**
 * Pure boundary from TanStack's read-only observer snapshot to the value an
 * Uklad subscription exposes. The full TanStack observer result remains
 * inside the adapter; only the mapped value crosses into Uklad (and a
 * compatibility projection may explicitly materialize it in state).
 */
export type QueryResultMapper<TData, TError, TResult> = (
  snapshot: QuerySnapshot<TData, TError>,
) => TResult;

/** A field whose changes may cause a mapped query result to be reconsidered. */
export type QuerySubscriptionObservedProperty = keyof QuerySnapshot<unknown, unknown>;

/**
 * Fields observed by the headless QueryObserver after its initial bind.
 *
 * The default is `['data', 'error']`: a background refetch with structurally
 * equal data never invalidates the Uklad graph. Opt into a field such as
 * `isFetching`, or use `'all'`, only when the mapper exposes that lifecycle
 * detail.
 */
export type QuerySubscriptionObserve = 'all' | readonly QuerySubscriptionObservedProperty[];

/** Options shared by cache-owned Query subscriptions and projections. */
export interface QuerySubscriptionConfig extends SubConfig {
  readonly observe?: QuerySubscriptionObserve;
}

/**
 * Explicit state destination for a Query projection.
 *
 * `stateKey` names the top-level state root that stores results. `update`
 * receives its latest value, the mapped value for this query instance, and the
 * lifecycle subscription's parameters. This supports both direct replacement
 * and keyed writes from parameterized derived subscriptions.
 *
 * @deprecated Use only with `regQueryProjection` when remote data is
 * intentionally materialized in Uklad state.
 */
export interface QueryProjectionTarget<
  TContracts extends UkladContracts,
  TStateKey extends ContractStateKey<TContracts>,
  TId extends ContractSubscriptionId<TContracts>,
> {
  readonly stateKey: TStateKey;
  readonly update: (
    current: ContractStateValue<TContracts, TStateKey>,
    value: ContractSubscriptionResult<TContracts, TId>,
    ...params: ContractSubscriptionParams<TContracts, TId>
  ) => ContractStateValue<TContracts, TStateKey>;
}

const DEFAULT_OBSERVED_PROPERTIES = ['data', 'error'] as const;
const QUERY_SNAPSHOT_PROPERTIES: ReadonlySet<QuerySubscriptionObservedProperty> = new Set([
  'data',
  'error',
  'status',
  'fetchStatus',
  'dataUpdatedAt',
  'errorUpdatedAt',
  'failureCount',
  'failureReason',
  'isError',
  'isFetched',
  'isFetching',
  'isLoading',
  'isPending',
  'isPaused',
  'isPlaceholderData',
  'isRefetching',
  'isStale',
  'isSuccess',
]);

/**
 * Register an explicit state-backed TanStack Query projection.
 *
 * This compatibility API deliberately transfers the mapped result into an
 * explicit Uklad state root. Prefer cache-owned `regQuerySub` for server data;
 * use this only when a workflow intentionally materializes a projection in
 * application state.
 *
 * The lifecycle subscription remains ordinary, whether root or derived.
 * `signals` are passive inputs only; Uklad samples them while the lifecycle
 * target has consumers and switch-maps the observer when they change. The
 * driver maps each QueryObserver result and applies `target` to its explicit
 * backing root through Uklad's private event → state → normal subscription
 * path.
 *
 * @deprecated Prefer cache-owned `regQuerySub` for server-state reads.
 */
export function regQueryProjection<
  TContracts extends UkladContracts,
  TId extends ContractSubscriptionId<TContracts>,
  TStateKey extends ContractStateKey<TContracts>,
  TSignals extends readonly ContractSubscribeVector<TContracts>[],
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
  TQueryData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  registrar: UkladRegistrar<TContracts>,
  queryClient: QueryClient,
  id: TId,
  target: QueryProjectionTarget<TContracts, TStateKey, TId>,
  signals: (...params: ContractSubscriptionParams<TContracts, TId>) => readonly [...TSignals],
  options: (
    signals: ContractSubscriptionSignalValues<TContracts, TSignals>,
    ...params: ContractSubscriptionParams<TContracts, TId>
  ) => QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>,
  mapResult: QueryResultMapper<TData, TError, ContractSubscriptionResult<TContracts, TId>>,
  config?: QuerySubscriptionConfig,
): void {
  assertAttachedQueryClient(queryClient);
  if (
    typeof target !== 'object' ||
    target === null ||
    typeof target.stateKey !== 'string' ||
    typeof target.update !== 'function'
  ) {
    throw new TypeError(
      `[uklad-tanstack-query] Query projection '${id}' requires a state target with an update function.`,
    );
  }
  registrar.regSubExt(id, signals, (context, ...params) => {
    return new QueryProjectionExtension(
      queryClient,
      (value) =>
        context.updateRoot(target.stateKey, (current) =>
          target.update(
            current as ContractStateValue<TContracts, TStateKey>,
            value as ContractSubscriptionResult<TContracts, TId>,
            ...(params as ContractSubscriptionParams<TContracts, TId>),
          ),
        ),
      (signalValues) =>
        options(
          signalValues as ContractSubscriptionSignalValues<TContracts, TSignals>,
          ...(params as ContractSubscriptionParams<TContracts, TId>),
        ),
      mapResult as QueryResultMapper<any, any, unknown>,
      config?.equalityCheck ?? Object.is,
      config?.observe,
    );
  });
}

/**
 * Register a cache-owned Query subscription on top of Uklad's external-source
 * primitive.
 *
 * This is the default Query integration. It does not require a state root or
 * write Query results into Uklad state: the Query cache is the source of truth,
 * and the mapped value is exposed directly by the external subscription.
 */
export function regQuerySub<
  TContracts extends UkladContracts,
  TId extends ContractSubscriptionId<TContracts>,
  TSignals extends readonly ContractSubscribeVector<TContracts>[],
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
  TQueryData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  registrar: UkladRegistrar<TContracts>,
  queryClient: QueryClient,
  id: TId,
  signals: (...params: ContractSubscriptionParams<TContracts, TId>) => readonly [...TSignals],
  options: (
    signals: ContractSubscriptionSignalValues<TContracts, TSignals>,
    ...params: ContractSubscriptionParams<TContracts, TId>
  ) => QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>,
  mapResult: QueryResultMapper<TData, TError, ContractSubscriptionResult<TContracts, TId>>,
  config?: QuerySubscriptionConfig,
): void {
  assertAttachedQueryClient(queryClient);
  registrar.regExternalSub(
    id,
    signals,
    (...params) =>
      new QueryExternalSubscriptionDriver<
        ContractSubscriptionDependencyValues<TContracts, TSignals>,
        ContractSubscriptionResult<TContracts, TId>,
        TQueryFnData,
        TError,
        TData,
        TQueryData,
        TQueryKey
      >(
        queryClient,
        (signalValues) =>
          options(
            signalValues as ContractSubscriptionSignalValues<TContracts, TSignals>,
            ...(params as ContractSubscriptionParams<TContracts, TId>),
          ),
        mapResult,
        config?.observe,
      ),
    config,
  );
}

/** One active Uklad extension instance owns one headless QueryObserver. */
class QueryProjectionExtension implements SubscriptionExtension<readonly unknown[]> {
  private readonly queryClient: QueryClient;
  private readonly publishResult: (value: unknown) => void;
  private readonly createOptions: (
    signals: readonly unknown[],
  ) => QueryObserverOptions<any, any, any, any, any>;
  private readonly mapResult: QueryResultMapper<any, any, unknown>;
  private readonly equalityCheck: EqualityCheckFn;
  private readonly observe: QuerySubscriptionObserve | undefined;
  private observer: QueryObserver<any, any, any, any, any> | undefined;
  private unsubscribe: (() => void) | undefined;
  private queryHash: string | undefined;
  private disposed = false;
  private hasPublishedValue = false;
  private publishedValue: unknown;

  constructor(
    queryClient: QueryClient,
    publishResult: (value: unknown) => void,
    createOptions: (signals: readonly unknown[]) => QueryObserverOptions<any, any, any, any, any>,
    mapResult: QueryResultMapper<any, any, unknown>,
    equalityCheck: EqualityCheckFn,
    observe: QuerySubscriptionObserve | undefined,
  ) {
    this.queryClient = queryClient;
    this.publishResult = publishResult;
    this.createOptions = createOptions;
    this.mapResult = mapResult;
    this.equalityCheck = equalityCheck;
    this.observe = observe;
  }

  sync(signals: readonly unknown[]): void {
    if (this.disposed) return;

    const observerOptions = withObservedProperties(this.createOptions(signals), this.observe);
    const defaultedOptions = this.queryClient.defaultQueryOptions(observerOptions);
    const nextQueryHash = defaultedOptions.queryHash;
    if (this.observer !== undefined && this.queryHash === nextQueryHash) return;

    this.disconnectObserver();
    this.queryHash = nextQueryHash;

    const observer = new QueryObserver(this.queryClient, defaultedOptions);
    this.observer = observer;
    const initialValue = this.mapResult(
      toQuerySnapshot(observer.getOptimisticResult(defaultedOptions)),
    );
    this.hasPublishedValue = true;
    this.publishedValue = initialValue;
    this.publishResult(initialValue);
    this.unsubscribe = observer.subscribe((result) => {
      if (this.disposed || this.observer !== observer || this.queryHash !== nextQueryHash) return;
      const value = this.mapResult(toQuerySnapshot(result));
      if (this.hasPublishedValue && this.equalityCheck(value, this.publishedValue)) return;
      this.hasPublishedValue = true;
      this.publishedValue = value;
      this.publishResult(value);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disconnectObserver();
  }

  private disconnectObserver(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.observer?.destroy();
    this.observer = undefined;
    this.queryHash = undefined;
    this.hasPublishedValue = false;
    this.publishedValue = undefined;
  }
}

/** One cache-owned external subscription instance owns one QueryObserver. */
class QueryExternalSubscriptionDriver<
  TInputs extends readonly unknown[],
  TResult,
  TQueryFnData,
  TError,
  TData,
  TQueryData,
  TQueryKey extends QueryKey,
> implements ExternalSubscriptionDriver<TInputs, TResult> {
  private readonly queryClient: QueryClient;
  private readonly createOptions: (
    inputs: TInputs,
  ) => QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>;
  private readonly mapResult: QueryResultMapper<TData, TError, TResult>;
  private readonly observe: QuerySubscriptionObserve | undefined;
  private observer: QueryObserver<TQueryFnData, TError, TData, TQueryData, TQueryKey> | undefined;
  private latestOptions:
    DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey> | undefined;
  private unsubscribe: (() => void) | undefined;
  private activationVersion = 0;
  private disposed = false;

  constructor(
    queryClient: QueryClient,
    createOptions: (
      inputs: TInputs,
    ) => QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>,
    mapResult: QueryResultMapper<TData, TError, TResult>,
    observe: QuerySubscriptionObserve | undefined,
  ) {
    this.queryClient = queryClient;
    this.createOptions = createOptions;
    this.mapResult = mapResult;
    this.observe = observe;
  }

  read(inputs: TInputs): TResult {
    if (this.disposed) {
      throw new Error('[uklad-tanstack-query] Cannot read a disposed Query subscription.');
    }
    const defaultedOptions = this.defaultOptions(inputs);
    this.latestOptions = defaultedOptions;
    const observer = this.ensureObserver(defaultedOptions);
    return this.mapResult(toQuerySnapshot(observer.getOptimisticResult(defaultedOptions)));
  }

  activate(inputs: TInputs, context: ExternalSubscriptionContext): void {
    if (this.disposed || this.unsubscribe !== undefined) return;
    const defaultedOptions = this.latestOptions ?? this.defaultOptions(inputs);
    this.latestOptions = defaultedOptions;
    const observer = this.ensureObserver(defaultedOptions);
    // A dormant dependency pull may have updated the options after the
    // observer was constructed. Apply that latest dormant configuration before
    // attaching the first listener; this is still pre-fetch because the
    // observer has no listeners yet.
    observer.setOptions(defaultedOptions);

    const activationVersion = ++this.activationVersion;
    this.unsubscribe = observer.subscribe(() => {
      // QueryObserver callbacks carry a mutable result. Core owns the read and
      // mapping step, so the callback only marks this activation dirty.
      if (
        this.disposed ||
        this.activationVersion !== activationVersion ||
        this.observer !== observer
      ) {
        return;
      }
      context.invalidate();
    });
  }

  sync(inputs: TInputs): void {
    if (this.disposed) return;
    const defaultedOptions = this.defaultOptions(inputs);
    this.latestOptions = defaultedOptions;
    const observer = this.ensureObserver(defaultedOptions);
    // Do not compare queryHash here. QueryObserver owns same-key option
    // changes (enabled, staleTime, callbacks, and so on) as well as key
    // switching, and every changed Uklad dependency tuple must reach it.
    observer.setOptions(defaultedOptions);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activationVersion++;
    const observer = this.observer;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    observer?.destroy();
    this.observer = undefined;
    this.latestOptions = undefined;
  }

  private defaultOptions(
    inputs: TInputs,
  ): DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey> {
    const observerOptions = withObservedProperties(this.createOptions(inputs), this.observe);
    return this.queryClient.defaultQueryOptions(observerOptions);
  }

  private ensureObserver(
    options: DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>,
  ): QueryObserver<TQueryFnData, TError, TData, TQueryData, TQueryKey> {
    if (this.observer === undefined) {
      this.observer = new QueryObserver(this.queryClient, options);
    }
    return this.observer;
  }
}

function withObservedProperties<
  TQueryFnData,
  TError,
  TData,
  TQueryData,
  TQueryKey extends QueryKey,
>(
  options: QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>,
  observe: QuerySubscriptionObserve | undefined,
): QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey> {
  const observedProperties = resolveObservedProperties(observe);
  return {
    ...options,
    notifyOnChangeProps: observedProperties as QueryObserverOptions<
      TQueryFnData,
      TError,
      TData,
      TQueryData,
      TQueryKey
    >['notifyOnChangeProps'],
  };
}

function resolveObservedProperties(
  observe: QuerySubscriptionObserve | undefined,
): QuerySubscriptionObserve {
  if (observe === undefined) return DEFAULT_OBSERVED_PROPERTIES;
  if (observe === 'all') return observe;
  if (
    !Array.isArray(observe) ||
    observe.some((property) => !QUERY_SNAPSHOT_PROPERTIES.has(property))
  ) {
    throw new TypeError(
      "[uklad-tanstack-query] QuerySubscriptionConfig.observe must be 'all' or an array of QuerySnapshot fields.",
    );
  }
  return observe;
}

export type { QuerySnapshot };
