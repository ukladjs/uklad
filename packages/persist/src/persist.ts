import { isRegistrationCollisionError } from '@ukladjs/core/vanilla';
import { getRuntimeIntegration } from '@ukladjs/core/internal';
import type {
  ContractState,
  PermissiveUkladContracts,
  UkladContracts,
  UkladRuntime,
} from '@ukladjs/core/vanilla';

import { encodeEnvelope, ignoreThenable, isThenable, stageEntry, type StagedEntry } from './codec';
import { normalizeOptions } from './config';
import { createAsyncCoordinator, type AsyncCoordinator } from './async-coordinator';
import { PERSIST_IDS } from './ids';
import {
  isCompletionPayload,
  isHydrationSnapshot,
  isHydrationGeneration,
  isPersistDiagnostic,
  isPersistDiagnosticArray,
  isPersistDiagnosticValue,
  isPersistProtocolEvent,
  isPurgeCompletionPayload,
  isWritePayload,
  type CompletionPayload,
  type HydrationSnapshot,
  type PurgeCompletionPayload,
  type RawByKey,
  type TerminalStatus,
} from './protocol';
import type {
  AnyState,
  AsyncPersistStorage,
  PersistDiagnostic,
  PersistErrorCode,
  PersistErrorPhase,
  PersistHandle,
  PersistOptions,
  PersistStatus,
  SyncPersistStorage,
} from './types';

type Runtime = UkladRuntime<PermissiveUkladContracts>;
type PersistEffect = [id: string] | [id: string, value: unknown];
type LifecycleState = PersistStatus | 'disposed';

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

interface PurgeWaiter extends Waiter {
  readonly request: string;
  accepted: boolean;
}

const attachedRuntimes = new WeakSet<object>();
const HYDRATION_ERROR = '[uklad-persist] Hydration failed.';
const DISPOSED_ERROR = '[uklad-persist] Disposed before operation completed.';
const PURGE_ERROR = '[uklad-persist] Purge failed.';
const EFFECT_AUTHORIZATION = '__ukladPersistAuthorization';
const WRITE_SNAPSHOT = '__ukladPersistWriteSnapshot';

/** Attach one persistence module to a runtime. */
export function persist<TContracts extends UkladContracts>(
  targetRuntime: UkladRuntime<TContracts>,
  options: PersistOptions<ContractState<TContracts>>,
): PersistHandle {
  if (typeof targetRuntime !== 'object' || targetRuntime === null) {
    throw new Error('[uklad-persist] persist() requires a Uklad runtime.');
  }

  const runtimeIdentity = targetRuntime as object;
  if (attachedRuntimes.has(runtimeIdentity)) {
    throw new Error('[uklad-persist] A persistence module is already attached to this runtime.');
  }

  const normalized = normalizeOptions(options as unknown as PersistOptions<AnyState>);
  const runtime = targetRuntime as unknown as Runtime;
  const integration = getRuntimeIntegration(runtime);

  const { storage, keyConfigs, version, prefix, migrate, onError } = normalized;
  const isSync = storage.sync === true;
  const asyncCoordinator: AsyncCoordinator | undefined = isSync
    ? undefined
    : createAsyncCoordinator();
  const configByKey = new Map(keyConfigs.map((config) => [config.key, config]));
  const storageKey = (key: string): string => `${prefix}/${encodeURIComponent(key)}`;

  let lifecycleState: LifecycleState = 'idle';
  let disposed = false;
  let disposalBarrier: Promise<void> = Promise.resolve();
  let purgeInFlight = false;
  const hydrationWaiters: Waiter[] = [];
  const purgeWaiters: PurgeWaiter[] = [];
  const authorizedEffects = new Set<string>();
  const authorizedEvents = new Set<string>();
  const queuedHydrationRequests = new Set<string>();
  let nextHydrationGeneration = 0;
  let activeHydrationGeneration = 0;
  const authorizedEventGenerations = new Map<string, number>();
  let nextAuthorization = 0;

  const issueAuthorization = (): string =>
    `${runtime.runtimeInstanceId}:${Date.now().toString(36)}:${(++nextAuthorization).toString(36)}:${Math.random().toString(36).slice(2)}`;

  const effect = (id: string, payload: object): PersistEffect => {
    const authorization = issueAuthorization();
    authorizedEffects.add(authorization);
    const authorizedPayload = { ...payload };
    // Effects execute within the current event, so this capability need not
    // cross an event-queue boundary. Keeping it non-enumerable prevents it
    // from becoming observable trace/effect data.
    Object.defineProperty(authorizedPayload, EFFECT_AUTHORIZATION, {
      value: authorization,
      enumerable: false,
    });
    if (Object.prototype.hasOwnProperty.call(payload, WRITE_SNAPSHOT)) {
      Object.defineProperty(authorizedPayload, WRITE_SNAPSHOT, {
        value: Reflect.get(payload, WRITE_SNAPSHOT),
        enumerable: false,
      });
    }
    return [id, authorizedPayload];
  };

  const writeEffect = (key: string, value: unknown): PersistEffect => {
    const payload = { key };
    Object.defineProperty(payload, WRITE_SNAPSHOT, {
      value,
      enumerable: false,
    });
    return effect(PERSIST_IDS.WRITE, payload);
  };

  const consumeEffectAuthorization = (value: unknown): object | undefined => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    const authorization = candidate[EFFECT_AUTHORIZATION];
    if (typeof authorization !== 'string' || !authorizedEffects.delete(authorization))
      return undefined;
    const payload = { ...candidate };
    delete payload[EFFECT_AUTHORIZATION];
    if (Object.prototype.hasOwnProperty.call(candidate, WRITE_SNAPSHOT)) {
      Object.defineProperty(payload, WRITE_SNAPSHOT, {
        value: Reflect.get(candidate, WRITE_SNAPSHOT),
        enumerable: false,
      });
    }
    return payload;
  };

  const consumeEventAuthorization = (
    authorization: unknown,
  ): { readonly authorization: string; readonly generation?: number } | undefined => {
    if (typeof authorization !== 'string' || !authorizedEvents.delete(authorization))
      return undefined;
    const generation = authorizedEventGenerations.get(authorization);
    authorizedEventGenerations.delete(authorization);
    return generation === undefined ? { authorization } : { authorization, generation };
  };

  const diagnostic = (
    code: PersistErrorCode,
    phase: PersistErrorPhase,
    key?: string,
  ): PersistDiagnostic => (key === undefined ? { code, phase } : { code, phase, key });

  const reportDiagnostic = (value: PersistDiagnostic): void => {
    const keySuffix = value.key === undefined ? '' : ` for key '${value.key}'`;
    console.warn(`[uklad-persist] ${value.code} during ${value.phase}${keySuffix}.`);
    if (!onError) return;
    try {
      onError(value);
    } catch {
      console.warn('[uklad-persist] onError callback failed.');
    }
  };

  const dispatchSyncAuthorized = (id: string, payload: object, generation?: number): void => {
    const authorization = issueAuthorization();
    authorizedEvents.add(authorization);
    if (generation !== undefined) authorizedEventGenerations.set(authorization, generation);
    try {
      integration.dispatchSync([id, payload, authorization]);
    } finally {
      authorizedEvents.delete(authorization);
      authorizedEventGenerations.delete(authorization);
    }
  };

  const failDroppedHydrationCompletion = (generation: number): void => {
    if (
      disposed ||
      activeHydrationGeneration !== generation ||
      (lifecycleState !== 'idle' && lifecycleState !== 'hydrating')
    )
      return;
    const value = diagnostic('event-queue-failed', 'lifecycle');
    try {
      dispatchSyncAuthorized(PERSIST_IDS.FAILED, value, generation);
    } catch {
      lifecycleState = 'failed';
      activeHydrationGeneration = 0;
      reportDiagnostic(value);
      settleHydrationWaiters();
    }
  };

  const failDroppedPurgeCompletion = (): void => {
    if (disposed || !purgeInFlight) return;
    const values = [diagnostic('event-queue-failed', 'lifecycle')];
    try {
      dispatchSyncAuthorized(PERSIST_IDS.PURGED, values);
    } catch {
      lifecycleState = 'failed';
      purgeInFlight = false;
      reportDiagnostic(values[0]!);
      settlePurgeWaiters('failed');
      settleHydrationWaiters();
    }
  };

  const dispatchAuthorized = (
    id: string,
    payload: object,
    onDropped: () => void,
    generation?: number,
  ): void => {
    const authorization = issueAuthorization();
    authorizedEvents.add(authorization);
    if (generation !== undefined) authorizedEventGenerations.set(authorization, generation);
    try {
      runtime.dispatch([id, payload, authorization]);
      void integration.flush().catch(() => {
        if (disposed || !authorizedEvents.delete(authorization)) return;
        authorizedEventGenerations.delete(authorization);
        onDropped();
      });
    } catch {
      authorizedEvents.delete(authorization);
      authorizedEventGenerations.delete(authorization);
      onDropped();
    }
  };

  const settleHydrationWaiters = (): void => {
    if (lifecycleState !== 'hydrated' && lifecycleState !== 'failed') return;
    if (lifecycleState === 'failed' && queuedHydrationRequests.size > 0) return;
    for (const waiter of hydrationWaiters.splice(0)) {
      if (lifecycleState === 'hydrated') waiter.resolve();
      else waiter.reject(new Error(HYDRATION_ERROR));
    }
  };

  const settlePurgeWaiters = (status: TerminalStatus): void => {
    for (let index = purgeWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = purgeWaiters[index]!;
      if (!waiter.accepted) continue;
      purgeWaiters.splice(index, 1);
      if (status === 'hydrated') waiter.resolve();
      else waiter.reject(new Error(PURGE_ERROR));
    }
  };

  const markPurgeAccepted = (request: unknown): void => {
    if (typeof request !== 'string') return;
    const waiter = purgeWaiters.find((candidate) => candidate.request === request);
    if (waiter) waiter.accepted = true;
  };

  const readAllSync = (): HydrationSnapshot => {
    const rawByKey = Object.create(null) as RawByKey;
    const diagnostics: PersistDiagnostic[] = [];
    const syncStorage = storage as SyncPersistStorage;

    for (const { key } of keyConfigs) {
      try {
        const raw = syncStorage.getItem(storageKey(key)) as unknown;
        if (isThenable(raw)) {
          ignoreThenable(raw);
          rawByKey[key] = null;
          diagnostics.push(diagnostic('sync-contract-violation', 'read', key));
        } else if (raw !== null && typeof raw !== 'string') {
          rawByKey[key] = null;
          diagnostics.push(diagnostic('invalid-storage-value', 'read', key));
        } else {
          rawByKey[key] = raw;
        }
      } catch {
        rawByKey[key] = null;
        diagnostics.push(diagnostic('storage-read-failed', 'read', key));
      }
    }
    return { rawByKey, diagnostics };
  };

  const readAllAsync = async (): Promise<HydrationSnapshot> => {
    const rawByKey = Object.create(null) as RawByKey;
    const diagnostics: PersistDiagnostic[] = [];
    const asyncStorage = storage as AsyncPersistStorage;

    await Promise.all(
      keyConfigs.map(async ({ key }) => {
        try {
          const raw = (await asyncStorage.getItem(storageKey(key))) as unknown;
          if (raw !== null && typeof raw !== 'string') {
            rawByKey[key] = null;
            diagnostics.push(diagnostic('invalid-storage-value', 'read', key));
          } else {
            rawByKey[key] = raw;
          }
        } catch {
          rawByKey[key] = null;
          diagnostics.push(diagnostic('storage-read-failed', 'read', key));
        }
      }),
    );
    return { rawByKey, diagnostics };
  };

  const applySnapshot = (
    draftState: AnyState,
    snapshot: HydrationSnapshot,
    generation: number,
  ): PersistEffect[] => {
    const diagnostics = [...snapshot.diagnostics];
    const staged: StagedEntry[] = [];

    for (const config of keyConfigs) {
      const raw = snapshot.rawByKey[config.key];
      if (raw == null) continue;
      const result = stageEntry(config, raw, {
        version,
        ...(migrate === undefined ? {} : { migrate }),
        diagnostic,
      });
      if (isPersistDiagnostic(result)) diagnostics.push(result);
      else staged.push(result);
    }

    for (const entry of staged) draftState[entry.key] = entry.value;

    const status: TerminalStatus = diagnostics.length === 0 ? 'hydrated' : 'failed';
    draftState[PERSIST_IDS.STATUS] = status;

    const effects: PersistEffect[] = diagnostics.map((value) => effect(PERSIST_IDS.REPORT, value));
    // Fail closed: partial good data may publish, but no migration is rewritten
    // unless every configured entry completed the full staging pipeline.
    if (status === 'hydrated') {
      for (const entry of staged) {
        if (entry.migrated) effects.push(writeEffect(entry.key, entry.value));
      }
    }
    effects.push(effect(PERSIST_IDS.COMPLETE, { status, generation } satisfies CompletionPayload));
    return effects;
  };

  const enqueueAsyncOperation = (
    key: string,
    operation: () => Promise<void>,
    failure: PersistDiagnostic,
  ): void => {
    if (!asyncCoordinator || disposed) return;
    const ticket = asyncCoordinator.enqueue(
      key,
      async () => {
        try {
          return await operation();
        } catch {
          if (!disposed) reportDiagnostic(failure);
          throw new Error(`[uklad-persist] ${failure.code}.`);
        }
      },
      { coalesce: true },
    );
    void ticket.promise.catch(() => {
      // The coordinator retains the sanitized failure for flush(); this local
      // catch prevents an unhandled rejection for event writes; callers that
      // need durability use handle.flush() to observe the retained failure.
    });
  };

  const removeOneForWrite = (key: string): void => {
    if (!isSync) {
      enqueueAsyncOperation(
        key,
        () => Promise.resolve(storage.removeItem(storageKey(key))),
        diagnostic('storage-remove-failed', 'write', key),
      );
      return;
    }

    try {
      const result = (storage as SyncPersistStorage).removeItem(storageKey(key)) as unknown;
      if (isThenable(result)) {
        ignoreThenable(result);
        reportDiagnostic(diagnostic('sync-contract-violation', 'write', key));
      }
    } catch {
      reportDiagnostic(diagnostic('storage-remove-failed', 'write', key));
    }
  };

  const writeKey = (key: string, value: unknown): void => {
    const config = configByKey.get(key);
    if (!config) return;

    if (value === undefined) {
      // A missing root means "no stored entry". A serializer returning
      // undefined, in contrast, is an invalid serialization below.
      removeOneForWrite(key);
      return;
    }

    let data: unknown = value;
    try {
      if (config.serialize) data = config.serialize(value);
      const thenable = isThenable(data);
      if (data === undefined || thenable) {
        if (thenable) ignoreThenable(data as PromiseLike<unknown>);
        reportDiagnostic(
          diagnostic(thenable ? 'sync-contract-violation' : 'serialize-failed', 'serialize', key),
        );
        return;
      }
    } catch {
      reportDiagnostic(diagnostic('serialize-failed', 'serialize', key));
      return;
    }

    const encoded = encodeEnvelope(version, data);
    if (encoded === undefined) {
      reportDiagnostic(diagnostic('serialize-failed', 'serialize', key));
      return;
    }

    try {
      if (!isSync) {
        enqueueAsyncOperation(
          key,
          () => Promise.resolve(storage.setItem(storageKey(key), encoded)),
          diagnostic('storage-write-failed', 'write', key),
        );
        return;
      }
      const result = (storage as SyncPersistStorage).setItem(storageKey(key), encoded) as unknown;
      if (isThenable(result)) {
        ignoreThenable(result);
        reportDiagnostic(diagnostic('sync-contract-violation', 'write', key));
      }
    } catch {
      reportDiagnostic(diagnostic('storage-write-failed', 'write', key));
    }
  };

  const removeAll = async (): Promise<PersistDiagnostic[]> => {
    const diagnostics: PersistDiagnostic[] = [];
    if (!isSync) {
      const operations = keyConfigs.map(({ key }) => {
        if (!asyncCoordinator)
          return Promise.resolve(diagnostic('storage-remove-failed', 'purge', key));
        const ticket = asyncCoordinator.enqueue(
          key,
          async () => {
            try {
              await storage.removeItem(storageKey(key));
              return undefined;
            } catch {
              const value = diagnostic('storage-remove-failed', 'purge', key);
              if (!disposed) reportDiagnostic(value);
              throw new Error(`[uklad-persist] ${value.code}.`);
            }
          },
          { trackFailure: false },
        );
        return ticket.promise.then(
          () => undefined,
          () => diagnostic('storage-remove-failed', 'purge', key),
        );
      });
      diagnostics.push(
        ...(await Promise.all(operations)).filter(
          (value): value is PersistDiagnostic => value !== undefined,
        ),
      );
      return diagnostics;
    }

    await Promise.all(
      keyConfigs.map(async ({ key }) => {
        try {
          const result = (storage as SyncPersistStorage).removeItem(storageKey(key)) as unknown;
          if (isThenable(result)) {
            ignoreThenable(result);
            diagnostics.push(diagnostic('sync-contract-violation', 'purge', key));
          }
        } catch {
          diagnostics.push(diagnostic('storage-remove-failed', 'purge', key));
        }
      }),
    );
    return diagnostics;
  };

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    lifecycleState = 'disposed';
    purgeInFlight = false;
    const coordinatorBarrier = asyncCoordinator?.dispose();
    authorizedEffects.clear();
    authorizedEventGenerations.clear();
    if (coordinatorBarrier) {
      disposalBarrier = coordinatorBarrier.then(() => {
        attachedRuntimes.delete(runtimeIdentity);
      });
    } else {
      attachedRuntimes.delete(runtimeIdentity);
    }
    for (const waiter of hydrationWaiters.splice(0)) waiter.reject(new Error(DISPOSED_ERROR));
    for (const waiter of purgeWaiters.splice(0)) waiter.reject(new Error(DISPOSED_ERROR));
  };

  attachedRuntimes.add(runtimeIdentity);
  let disposeModule: (() => void) | undefined;
  try {
    disposeModule = runtime.registerModule((scope) => {
      scope.regRootSub(PERSIST_IDS.STATUS, PERSIST_IDS.STATUS);
      scope.regEvent(
        PERSIST_IDS.ATTACH,
        ({ draftState }, _payload: unknown, authorization: unknown) => {
          if (!consumeEventAuthorization(authorization)) {
            return [effect(PERSIST_IDS.REPORT, diagnostic('invalid-completion', 'lifecycle'))];
          }
          (draftState as AnyState)[PERSIST_IDS.STATUS] = 'idle';
          return undefined;
        },
      );

      if (isSync) {
        scope.regCoeffect(PERSIST_IDS.SNAPSHOT, () =>
          lifecycleState === 'idle' || lifecycleState === 'failed'
            ? readAllSync()
            : { rawByKey: Object.create(null) as RawByKey, diagnostics: [] },
        );
        scope.regEvent(
          PERSIST_IDS.HYDRATE,
          ({ draftState, coeffects: { snapshot } }) => {
            if (lifecycleState === 'hydrating' || lifecycleState === 'hydrated') {
              return [effect(PERSIST_IDS.SETTLE, {})];
            }
            if (lifecycleState !== 'idle' && lifecycleState !== 'failed') {
              return [effect(PERSIST_IDS.SETTLE, {})];
            }
            const generation = ++nextHydrationGeneration;
            activeHydrationGeneration = generation;
            lifecycleState = 'hydrating';
            return applySnapshot(draftState as AnyState, snapshot as HydrationSnapshot, generation);
          },
          { coeffects: { snapshot: PERSIST_IDS.SNAPSHOT } },
        );
      } else {
        scope.regEvent(PERSIST_IDS.HYDRATE, ({ draftState }, requestPayload: unknown) => {
          const requestedRequest =
            typeof requestPayload === 'object' && requestPayload !== null
              ? (Reflect.get(requestPayload, 'request') as unknown)
              : requestPayload;
          const requestedGeneration =
            typeof requestPayload === 'object' && requestPayload !== null
              ? (Reflect.get(requestPayload, 'generation') as unknown)
              : undefined;
          const isQueuedHandleAttempt =
            typeof requestedRequest === 'string' &&
            isHydrationGeneration(requestedGeneration) &&
            requestedGeneration === activeHydrationGeneration &&
            queuedHydrationRequests.has(requestedRequest);
          if (
            (lifecycleState === 'hydrating' || lifecycleState === 'hydrated') &&
            !isQueuedHandleAttempt
          ) {
            if (typeof requestedRequest === 'string')
              queuedHydrationRequests.delete(requestedRequest);
            return [effect(PERSIST_IDS.SETTLE, {})];
          }
          if (lifecycleState !== 'idle' && lifecycleState !== 'failed' && !isQueuedHandleAttempt) {
            if (typeof requestedRequest === 'string')
              queuedHydrationRequests.delete(requestedRequest);
            return [effect(PERSIST_IDS.SETTLE, {})];
          }
          const generation = isHydrationGeneration(requestedGeneration)
            ? requestedGeneration
            : ++nextHydrationGeneration;
          nextHydrationGeneration = Math.max(nextHydrationGeneration, generation);
          activeHydrationGeneration = generation;
          lifecycleState = 'hydrating';
          (draftState as AnyState)[PERSIST_IDS.STATUS] = 'hydrating';
          return [effect(PERSIST_IDS.READ, { request: requestedRequest, generation })];
        });
      }

      scope.regEffect(PERSIST_IDS.READ, (payload: unknown) => {
        const authorizedPayload = consumeEffectAuthorization(payload);
        if (!authorizedPayload) {
          reportDiagnostic(diagnostic('invalid-completion', 'lifecycle'));
          return;
        }
        {
          const request = Reflect.get(authorizedPayload, 'request') as unknown;
          if (typeof request === 'string') {
            queuedHydrationRequests.delete(request);
          }
        }
        const generation = Reflect.get(authorizedPayload, 'generation') as unknown;
        if (
          !isHydrationGeneration(generation) ||
          disposed ||
          lifecycleState !== 'hydrating' ||
          activeHydrationGeneration !== generation
        )
          return;
        void readAllAsync()
          .then((snapshot) => {
            if (!disposed) {
              dispatchAuthorized(
                PERSIST_IDS.LOADED,
                snapshot,
                () => failDroppedHydrationCompletion(generation),
                generation,
              );
            }
          })
          .catch(() => {
            if (!disposed) {
              dispatchAuthorized(
                PERSIST_IDS.FAILED,
                diagnostic('storage-read-failed', 'read'),
                () => failDroppedHydrationCompletion(generation),
                generation,
              );
            }
          });
      });
      scope.regEvent(
        PERSIST_IDS.LOADED,
        ({ draftState }, snapshot: unknown, authorization: unknown) => {
          const capability = consumeEventAuthorization(authorization);
          if (!capability) {
            return [effect(PERSIST_IDS.REPORT, diagnostic('invalid-completion', 'lifecycle'))];
          }
          const generation = capability.generation;
          if (
            !isHydrationGeneration(generation) ||
            lifecycleState !== 'hydrating' ||
            activeHydrationGeneration !== generation
          ) {
            return [effect(PERSIST_IDS.REPORT, diagnostic('invalid-completion', 'lifecycle'))];
          }
          if (!isHydrationSnapshot(snapshot, keyConfigs)) {
            (draftState as AnyState)[PERSIST_IDS.STATUS] = 'failed';
            return [
              effect(PERSIST_IDS.REPORT, diagnostic('invalid-completion', 'lifecycle')),
              effect(PERSIST_IDS.COMPLETE, {
                status: 'failed',
                generation,
              } satisfies CompletionPayload),
            ];
          }
          return applySnapshot(draftState as AnyState, snapshot, generation);
        },
      );
      scope.regEvent(
        PERSIST_IDS.FAILED,
        ({ draftState }, value: unknown, authorization: unknown) => {
          const capability = consumeEventAuthorization(authorization);
          if (!capability) {
            return [effect(PERSIST_IDS.REPORT, diagnostic('invalid-completion', 'lifecycle'))];
          }
          const generation = capability.generation;
          if (
            !isHydrationGeneration(generation) ||
            (lifecycleState !== 'idle' && lifecycleState !== 'hydrating') ||
            activeHydrationGeneration !== generation
          ) {
            return [effect(PERSIST_IDS.REPORT, diagnostic('invalid-completion', 'lifecycle'))];
          }
          const reported = isPersistDiagnosticValue(value)
            ? value
            : diagnostic('invalid-completion', 'lifecycle');
          (draftState as AnyState)[PERSIST_IDS.STATUS] = 'failed';
          return [
            effect(PERSIST_IDS.REPORT, reported),
            effect(PERSIST_IDS.COMPLETE, {
              status: 'failed',
              generation,
            } satisfies CompletionPayload),
          ];
        },
      );

      scope.regEvent(PERSIST_IDS.PURGE, ({ draftState }, request: unknown) => {
        if (purgeInFlight) {
          markPurgeAccepted(request);
          return;
        }
        if (lifecycleState === 'hydrating') {
          return [
            effect(PERSIST_IDS.REPORT, diagnostic('purge-during-hydration', 'lifecycle')),
            effect(PERSIST_IDS.REJECT_PURGE, { request }),
          ];
        }
        (draftState as AnyState)[PERSIST_IDS.STATUS] = 'hydrating';
        return [effect(PERSIST_IDS.REMOVE, { request })];
      });
      scope.regEffect(PERSIST_IDS.REMOVE, (payload: unknown) => {
        const authorizedPayload = consumeEffectAuthorization(payload);
        if (!authorizedPayload) {
          reportDiagnostic(diagnostic('invalid-completion', 'lifecycle'));
          return;
        }
        markPurgeAccepted(Reflect.get(authorizedPayload, 'request'));
        if (disposed || purgeInFlight) return;
        purgeInFlight = true;
        void removeAll().then((diagnostics) => {
          if (!disposed) {
            dispatchAuthorized(PERSIST_IDS.PURGED, diagnostics, failDroppedPurgeCompletion);
          }
        });
      });
      scope.regEvent(
        PERSIST_IDS.PURGED,
        ({ draftState }, value: unknown, authorization: unknown) => {
          if (!consumeEventAuthorization(authorization)) {
            return [effect(PERSIST_IDS.REPORT, diagnostic('invalid-completion', 'lifecycle'))];
          }
          if (!purgeInFlight) {
            return [effect(PERSIST_IDS.REPORT, diagnostic('invalid-completion', 'lifecycle'))];
          }
          const diagnostics = isPersistDiagnosticArray(value)
            ? value
            : [diagnostic('invalid-completion', 'lifecycle')];
          const status: TerminalStatus = diagnostics.length === 0 ? 'hydrated' : 'failed';
          (draftState as AnyState)[PERSIST_IDS.STATUS] = status;
          return [
            ...diagnostics.map((diagnosticValue): PersistEffect =>
              effect(PERSIST_IDS.REPORT, diagnosticValue),
            ),
            effect(PERSIST_IDS.COMPLETE_PURGE, {
              status,
              diagnostics,
            } satisfies PurgeCompletionPayload),
          ];
        },
      );

      // Runtime-wide rather than module-scoped, so this module's cleanup
      // removes it by id along with everything else registered here.
      integration.addInterceptor({
        id: PERSIST_IDS.WRITER,
        comment: 'Persists configured roots changed by the causing event.',
        after: (context) => {
          const [eventId] = context.coeffects.event;
          if (isPersistProtocolEvent(eventId)) return context;
          const newState = context.newState as AnyState | undefined;
          if (
            newState === undefined ||
            lifecycleState !== 'hydrated' ||
            newState[PERSIST_IDS.STATUS] !== 'hydrated'
          ) {
            return context;
          }

          const previousState = context.previousState as AnyState;
          for (const { key } of keyConfigs) {
            if (!Object.is(newState[key], previousState[key])) {
              context.effects.push(writeEffect(key, newState[key]));
            }
          }
          return context;
        },
      });

      scope.regEffect(PERSIST_IDS.WRITE, (payload: unknown) => {
        const authorizedPayload = consumeEffectAuthorization(payload);
        if (!authorizedPayload || !isWritePayload(authorizedPayload)) {
          reportDiagnostic(diagnostic('invalid-completion', 'lifecycle'));
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(authorizedPayload, WRITE_SNAPSHOT)) {
          reportDiagnostic(diagnostic('invalid-completion', 'lifecycle'));
          return;
        }
        writeKey(authorizedPayload.key, Reflect.get(authorizedPayload, WRITE_SNAPSHOT));
      });
      scope.regEffect(PERSIST_IDS.COMPLETE, (payload: unknown) => {
        const authorizedPayload = consumeEffectAuthorization(payload);
        if (!authorizedPayload || !isCompletionPayload(authorizedPayload)) {
          reportDiagnostic(diagnostic('invalid-completion', 'lifecycle'));
          if (authorizedPayload) {
            lifecycleState = 'failed';
            settleHydrationWaiters();
          }
          return;
        }
        if (authorizedPayload.generation !== activeHydrationGeneration) {
          reportDiagnostic(diagnostic('invalid-completion', 'lifecycle'));
          return;
        }
        lifecycleState = authorizedPayload.status;
        activeHydrationGeneration = 0;
        settleHydrationWaiters();
      });
      scope.regEffect(PERSIST_IDS.COMPLETE_PURGE, (payload: unknown) => {
        const authorizedPayload = consumeEffectAuthorization(payload);
        if (!authorizedPayload || !isPurgeCompletionPayload(authorizedPayload)) {
          reportDiagnostic(diagnostic('invalid-completion', 'lifecycle'));
          if (authorizedPayload) {
            lifecycleState = 'failed';
            purgeInFlight = false;
            settlePurgeWaiters('failed');
            settleHydrationWaiters();
          }
          return;
        }
        lifecycleState = authorizedPayload.status;
        purgeInFlight = false;
        settlePurgeWaiters(authorizedPayload.status);
        settleHydrationWaiters();
      });
      scope.regEffect(PERSIST_IDS.SETTLE, (payload: unknown) => {
        if (!consumeEffectAuthorization(payload)) {
          reportDiagnostic(diagnostic('invalid-completion', 'lifecycle'));
          return;
        }
        settleHydrationWaiters();
      });
      scope.regEffect(PERSIST_IDS.REJECT_PURGE, (payload: unknown) => {
        const authorizedPayload = consumeEffectAuthorization(payload);
        if (!authorizedPayload) {
          reportDiagnostic(diagnostic('invalid-completion', 'lifecycle'));
          return;
        }
        markPurgeAccepted(Reflect.get(authorizedPayload, 'request'));
        settlePurgeWaiters('failed');
      });
      scope.regEffect(PERSIST_IDS.REPORT, (payload: unknown) => {
        const authorizedPayload = consumeEffectAuthorization(payload);
        if (!authorizedPayload || !isPersistDiagnosticValue(authorizedPayload)) {
          reportDiagnostic(diagnostic('invalid-completion', 'lifecycle'));
          return;
        }
        reportDiagnostic(authorizedPayload);
      });

      return () => {
        integration.removeInterceptor(PERSIST_IDS.WRITER);
        cleanup();
      };
    });

    // Publish a fresh attachment-scoped gate. This closes writes even when a
    // previous disposed attachment left a terminal status in state.
    dispatchSyncAuthorized(PERSIST_IDS.ATTACH, {});
  } catch (error) {
    try {
      disposeModule?.();
    } finally {
      cleanup();
    }
    if (isRegistrationCollisionError(error)) {
      throw new Error('[uklad-persist] Protocol registration collision.', { cause: error });
    }
    throw error;
  }

  const installedDisposer = disposeModule;
  return {
    hydrate(): void {
      if (disposed) throw new Error(DISPOSED_ERROR);
      if (purgeInFlight || purgeWaiters.length > 0) {
        throw new Error('[uklad-persist] Cannot hydrate while purge is in progress.');
      }
      if (isSync) {
        try {
          integration.dispatchSync([PERSIST_IDS.HYDRATE]);
        } catch (error) {
          // A before-interceptor can abort HYDRATE before its handler allocates
          // a generation. Create a valid fallback generation so waiters still
          // receive a terminal failure instead of remaining pending forever.
          const generation = isHydrationGeneration(activeHydrationGeneration)
            ? activeHydrationGeneration
            : ++nextHydrationGeneration;
          activeHydrationGeneration = generation;
          if (lifecycleState === 'idle') lifecycleState = 'hydrating';
          failDroppedHydrationCompletion(generation);
          throw error;
        }
      } else {
        if (lifecycleState === 'hydrating' || lifecycleState === 'hydrated') return;
        const request = issueAuthorization();
        const generation = ++nextHydrationGeneration;
        queuedHydrationRequests.add(request);
        lifecycleState = 'hydrating';
        activeHydrationGeneration = generation;
        try {
          runtime.dispatch([PERSIST_IDS.HYDRATE, { request, generation }]);
          void integration.flush().catch(() => {
            if (disposed || !queuedHydrationRequests.delete(request)) return;
            failDroppedHydrationCompletion(generation);
          });
        } catch (error) {
          queuedHydrationRequests.delete(request);
          failDroppedHydrationCompletion(generation);
          throw error;
        }
      }
    },
    whenHydrated(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (disposed) {
          reject(new Error(DISPOSED_ERROR));
          return;
        }
        // A retry request is queued before its async HYDRATE event runs. Do
        // not immediately reject a waiter against the previous failed attempt
        // while that next generation is waiting in the runtime queue.
        if (lifecycleState === 'failed' && queuedHydrationRequests.size === 0) {
          reject(new Error(HYDRATION_ERROR));
          return;
        }
        hydrationWaiters.push({ resolve, reject });
        settleHydrationWaiters();
      });
    },
    async flush(): Promise<void> {
      if (disposed) throw new Error(DISPOSED_ERROR);
      await integration.flush();
      if (!asyncCoordinator) return;
      await asyncCoordinator.flush();
    },
    purge(): Promise<void> {
      if (disposed) return Promise.reject(new Error(DISPOSED_ERROR));

      const request = issueAuthorization();
      let waiter: PurgeWaiter;
      const pending = new Promise<void>((resolve, reject) => {
        waiter = { resolve, reject, request, accepted: false };
        purgeWaiters.push(waiter);
      });
      try {
        runtime.dispatch([PERSIST_IDS.PURGE, request]);
        void integration.flush().catch(() => {
          if (disposed || waiter!.accepted) return;
          const index = purgeWaiters.indexOf(waiter!);
          if (index < 0) return;
          purgeWaiters.splice(index, 1);
          reportDiagnostic(diagnostic('event-queue-failed', 'lifecycle'));
          waiter!.reject(new Error(PURGE_ERROR));
        });
      } catch {
        const index = purgeWaiters.indexOf(waiter!);
        if (index >= 0) purgeWaiters.splice(index, 1);
        waiter!.reject(new Error(PURGE_ERROR));
      }
      return pending;
    },
    async dispose(): Promise<void> {
      if (!disposed) installedDisposer?.();
      await disposalBarrier;
    },
  };
}
