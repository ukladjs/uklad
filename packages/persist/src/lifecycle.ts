import type { PersistStatus } from './types';
import type { TerminalStatus } from './protocol';

export const HYDRATION_ERROR = '[uklad-persist] Hydration failed.';
export const DISPOSED_ERROR = '[uklad-persist] Disposed before operation completed.';
export const PURGE_ERROR = '[uklad-persist] Purge failed.';

export type PersistLifecycleState = PersistStatus | 'disposed';

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

interface PurgeWaiter extends Waiter {
  readonly request: string;
  accepted: boolean;
}

export interface PurgeTicket {
  readonly request: string;
  readonly promise: Promise<void>;
}

export type PurgeAdmission = 'start' | 'joined' | 'rejected';

export interface PersistLifecycle {
  readonly state: PersistLifecycleState;
  readonly disposed: boolean;
  readonly purgeInFlight: boolean;
  readonly activeHydrationGeneration: number;
  readonly hasPurgeWork: boolean;
  canStageSyncRead(): boolean;
  canWrite(): boolean;
  acceptSyncHydration(): number | undefined;
  queueAsyncHydration(request: string): number | undefined;
  acceptAsyncHydration(request: unknown, generation: unknown): number | undefined;
  consumeQueuedHydrationRequest(request: unknown): boolean;
  canAcceptHydrationCompletion(
    generation: unknown,
    allowedStates?: readonly PersistLifecycleState[],
  ): generation is number;
  ensureHydrationGenerationAfterDispatchFailure(): number;
  failHydrationIfCurrent(generation: number): boolean;
  forceHydrationFailure(): void;
  completeHydration(status: TerminalStatus, generation: number): boolean;
  settleHydration(): void;
  whenHydrated(): Promise<void>;
  admitPurge(request: unknown): PurgeAdmission;
  acceptPurgeRequest(request: unknown): void;
  beginPurge(request: unknown): boolean;
  createPurgeTicket(request: string): PurgeTicket;
  isPurgeAccepted(ticket: PurgeTicket): boolean;
  cancelPurge(ticket: PurgeTicket, onlyIfUnaccepted?: boolean): boolean;
  rejectAcceptedPurges(): void;
  forcePurgeFailure(): void;
  completePurge(status: TerminalStatus): void;
  dispose(): void;
}

export function createPersistLifecycle(): PersistLifecycle {
  let state: PersistLifecycleState = 'idle';
  let purgeInFlight = false;
  let nextHydrationGeneration = 0;
  let activeHydrationGeneration = 0;
  const queuedHydrationRequests = new Set<string>();
  const hydrationWaiters: Waiter[] = [];
  const purgeWaiters: PurgeWaiter[] = [];

  const settleHydration = (): void => {
    if (state !== 'hydrated' && state !== 'failed') return;
    if (state === 'failed' && queuedHydrationRequests.size > 0) return;
    for (const waiter of hydrationWaiters.splice(0)) {
      if (state === 'hydrated') waiter.resolve();
      else waiter.reject(new Error(HYDRATION_ERROR));
    }
  };

  const settleAcceptedPurges = (status: TerminalStatus): void => {
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

  const beginHydration = (generation?: number): number => {
    const acceptedGeneration = generation ?? ++nextHydrationGeneration;
    nextHydrationGeneration = Math.max(nextHydrationGeneration, acceptedGeneration);
    activeHydrationGeneration = acceptedGeneration;
    state = 'hydrating';
    return acceptedGeneration;
  };

  const controller: PersistLifecycle = {
    get state() {
      return state;
    },
    get disposed() {
      return state === 'disposed';
    },
    get purgeInFlight() {
      return purgeInFlight;
    },
    get activeHydrationGeneration() {
      return activeHydrationGeneration;
    },
    get hasPurgeWork() {
      return purgeInFlight || purgeWaiters.length > 0;
    },
    canStageSyncRead: () => state === 'idle' || state === 'failed',
    canWrite: () => state === 'hydrated',
    acceptSyncHydration(): number | undefined {
      if (state !== 'idle' && state !== 'failed') return undefined;
      return beginHydration();
    },
    queueAsyncHydration(request: string): number | undefined {
      if (state === 'hydrating' || state === 'hydrated') return undefined;
      const generation = beginHydration();
      queuedHydrationRequests.add(request);
      return generation;
    },
    acceptAsyncHydration(request: unknown, generation: unknown): number | undefined {
      const queuedAttempt =
        typeof request === 'string' &&
        typeof generation === 'number' &&
        Number.isSafeInteger(generation) &&
        generation > 0 &&
        generation === activeHydrationGeneration &&
        queuedHydrationRequests.has(request);
      if (!queuedAttempt && state !== 'idle' && state !== 'failed') {
        if (typeof request === 'string') queuedHydrationRequests.delete(request);
        return undefined;
      }
      const acceptedGeneration =
        typeof generation === 'number' && Number.isSafeInteger(generation) && generation > 0
          ? generation
          : undefined;
      return beginHydration(acceptedGeneration);
    },
    consumeQueuedHydrationRequest(request: unknown): boolean {
      return typeof request === 'string' && queuedHydrationRequests.delete(request);
    },
    canAcceptHydrationCompletion(
      generation: unknown,
      allowedStates: readonly PersistLifecycleState[] = ['hydrating'],
    ): generation is number {
      return (
        typeof generation === 'number' &&
        Number.isSafeInteger(generation) &&
        generation > 0 &&
        generation === activeHydrationGeneration &&
        allowedStates.includes(state)
      );
    },
    ensureHydrationGenerationAfterDispatchFailure(): number {
      if (activeHydrationGeneration > 0) return activeHydrationGeneration;
      const generation = ++nextHydrationGeneration;
      activeHydrationGeneration = generation;
      if (state === 'idle') state = 'hydrating';
      return generation;
    },
    failHydrationIfCurrent(generation: number): boolean {
      if (
        state === 'disposed' ||
        activeHydrationGeneration !== generation ||
        (state !== 'idle' && state !== 'hydrating')
      ) {
        return false;
      }
      state = 'failed';
      activeHydrationGeneration = 0;
      settleHydration();
      return true;
    },
    forceHydrationFailure(): void {
      if (state === 'disposed') return;
      state = 'failed';
      activeHydrationGeneration = 0;
      settleHydration();
    },
    completeHydration(status: TerminalStatus, generation: number): boolean {
      if (generation !== activeHydrationGeneration) return false;
      state = status;
      activeHydrationGeneration = 0;
      settleHydration();
      return true;
    },
    settleHydration,
    whenHydrated(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (state === 'disposed') {
          reject(new Error(DISPOSED_ERROR));
          return;
        }
        if (state === 'failed' && queuedHydrationRequests.size === 0) {
          reject(new Error(HYDRATION_ERROR));
          return;
        }
        hydrationWaiters.push({ resolve, reject });
        settleHydration();
      });
    },
    admitPurge(request: unknown): PurgeAdmission {
      if (purgeInFlight) {
        markPurgeAccepted(request);
        return 'joined';
      }
      return state === 'hydrating' ? 'rejected' : 'start';
    },
    acceptPurgeRequest(request: unknown): void {
      markPurgeAccepted(request);
    },
    beginPurge(request: unknown): boolean {
      markPurgeAccepted(request);
      if (state === 'disposed' || purgeInFlight) return false;
      purgeInFlight = true;
      return true;
    },
    createPurgeTicket(request: string): PurgeTicket {
      let waiter!: PurgeWaiter;
      const promise = new Promise<void>((resolve, reject) => {
        waiter = { resolve, reject, request, accepted: false };
        purgeWaiters.push(waiter);
      });
      return { request, promise };
    },
    isPurgeAccepted(ticket: PurgeTicket): boolean {
      return purgeWaiters.some((waiter) => waiter.request === ticket.request && waiter.accepted);
    },
    cancelPurge(ticket: PurgeTicket, onlyIfUnaccepted = false): boolean {
      const index = purgeWaiters.findIndex((waiter) => waiter.request === ticket.request);
      if (index < 0) return false;
      const waiter = purgeWaiters[index]!;
      if (onlyIfUnaccepted && waiter.accepted) return false;
      purgeWaiters.splice(index, 1);
      waiter.reject(new Error(PURGE_ERROR));
      return true;
    },
    rejectAcceptedPurges(): void {
      settleAcceptedPurges('failed');
    },
    forcePurgeFailure(): void {
      if (state === 'disposed') return;
      state = 'failed';
      purgeInFlight = false;
      settleAcceptedPurges('failed');
      settleHydration();
    },
    completePurge(status: TerminalStatus): void {
      if (state === 'disposed') return;
      state = status;
      purgeInFlight = false;
      settleAcceptedPurges(status);
      settleHydration();
    },
    dispose(): void {
      if (state === 'disposed') return;
      state = 'disposed';
      purgeInFlight = false;
      queuedHydrationRequests.clear();
      for (const waiter of hydrationWaiters.splice(0)) waiter.reject(new Error(DISPOSED_ERROR));
      for (const waiter of purgeWaiters.splice(0)) waiter.reject(new Error(DISPOSED_ERROR));
    },
  };

  return controller;
}
