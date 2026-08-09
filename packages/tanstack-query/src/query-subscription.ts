import { QueryObserver } from '@tanstack/query-core';

import type { QueryClient, QueryKey, QueryObserverOptions } from '@tanstack/query-core';
import type {
  ContractSubscribeVector,
  ContractStateKey,
  ContractStateValue,
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

import { assertAttachedQueryClient } from './lifecycle';
import { toQuerySnapshot } from './query-snapshot';

import type { QuerySnapshot } from './query-snapshot';

/**
 * Pure boundary from TanStack's read-only observer snapshot to the value an
 * Uklad subscription exposes. Only this return value enters Uklad STATE; the
 * full TanStack observer result remains inside the adapter.
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
 * equal data never reaches Uklad's event/state boundary. Opt into a field such
 * as `isFetching`, or use `'all'`, only when the mapper exposes that lifecycle
 * detail.
 */
export type QuerySubscriptionObserve = 'all' | readonly QuerySubscriptionObservedProperty[];

/** Options owned by Uklad's state-backed Query subscription extension. */
export interface QuerySubscriptionConfig extends SubConfig {
  readonly observe?: QuerySubscriptionObserve;
}

/**
 * Explicit state destination for a Query-backed subscription.
 *
 * `stateKey` names the top-level state root that stores results. `update`
 * receives its latest value, the mapped value for this query instance, and the
 * lifecycle subscription's parameters. This supports both direct replacement
 * and keyed writes from parameterized derived subscriptions.
 */
export interface QuerySubscriptionTarget<
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
 * Attach a TanStack Query driver to an already-registered Uklad subscription.
 *
 * The lifecycle subscription remains ordinary, whether root or derived.
 * `signals` are passive inputs only; Uklad samples them while the lifecycle
 * target has consumers and switch-maps the observer when they change. The
 * driver maps each QueryObserver result and applies `target`
 * to its explicit backing root through Uklad's private event → state → normal
 * subscription path.
 */
export function regQuerySub<
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
  target: QuerySubscriptionTarget<TContracts, TStateKey, TId>,
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
      `[uklad-tanstack-query] Query subscription '${id}' requires a state target with an update function.`,
    );
  }
  registrar.regSubExt(id, signals, (context, ...params) => {
    return new StateBackedQueryExtension(
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

/** One active Uklad extension instance owns one headless QueryObserver. */
class StateBackedQueryExtension implements SubscriptionExtension<readonly unknown[]> {
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
