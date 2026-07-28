import type { Draft } from 'immer';

import type { ContractState, DefaultContracts } from './contracts';

// State and shared identifiers

export type State<T = Record<string, any>> = T;
export type Id = string;

/** The ambient application state, or `Record<string, any>` while undeclared. */
export type DefaultAppState = ContractState<DefaultContracts>;

export type EqualityCheckFn = (a: any, b: any) => boolean;

// Events

export type EventVector = [Id, ...any[]];

export type EventHandler<T = DefaultAppState, P extends readonly any[] = any[]> = (
  coeffects: CoEffects<T>,
  ...params: P
) => Effects | void;

/** Optional coeffects and interceptors applied when registering an event. */
export interface EventRegistrationOptions<T = DefaultAppState> {
  coeffects?: ReadonlyArray<readonly [id: Id] | readonly [id: Id, value: unknown]>;
  interceptors?: ReadonlyArray<Interceptor<T>>;
}

// Effects and coeffects

/** One effect intent: an id with an optional payload. */
export type EffectVector = [id: Id, value?: any];

/** The effect list an event handler returns, before contract narrowing. */
export type Effects = EffectVector[];

export interface DispatchLaterEffect {
  ms: number;
  dispatch: EventVector;
}

/** Runtime capability supplied to custom effect handlers. */
export interface EffectRuntimeContext {
  readonly runtimeId: string;
  readonly runtimeName: string;
  dispatch(event: EventVector): void;
  debounceAndDispatch(event: EventVector, durationMs: number): void;
  throttleAndDispatch(event: EventVector, durationMs: number): void;
}

export type EffectHandler<V = any> = (value: V, runtime: EffectRuntimeContext) => void;

export interface CoEffects<T = DefaultAppState> {
  event: EventVector;
  draftState: Draft<State<T>>;
  [key: string]: any;
}

export type CoEffectHandler<T = DefaultAppState> = (
  coeffects: CoEffects<T>,
  value?: any,
) => CoEffects<T>;

// Interceptor pipeline and errors

export interface Context<T = Record<string, any>> {
  coeffects: CoEffects<T>;
  /**
   * The state generation captured before this event's interceptor chain
   * begins. Interceptors may observe it but must not replace it.
   */
  readonly previousState: State<T>;
  /** The shared effect list. Interceptors may append entries but must not replace it. */
  readonly effects: Effects;
  /** Invalid legacy effect values retained for the post-commit executor to report. */
  readonly invalidEffects?: readonly unknown[];
  /**
   * The final state generation produced by the event handler; unset until it
   * runs. Interceptors may observe it but must not replace it.
   */
  readonly newState?: State<T>;
  queue: Interceptor<T>[];
  stack: Interceptor<T>[];
  originalException: boolean;
  /** Internal structured failure retained when a custom error handler recovers. */
  readonly executionError?: unknown;
}

export interface Interceptor<T = Record<string, any>> {
  id: string;
  before?: (context: Context<T>) => Context<T>;
  after?: (context: Context<T>) => Context<T>;
  comment?: string;
}

export type InterceptorDirection = 'before' | 'after';

export interface InterceptorErrorData {
  direction: InterceptorDirection;
  interceptor: string;
  originalError: Error;
  eventV?: EventVector;
}

export interface ReflexError extends Error {
  data: InterceptorErrorData;
  cause: Error;
}

export type ErrorHandler = (originalError: Error, reflexError: ReflexError) => void;

// Subscriptions

export type SubVector = [Id, ...any[]];

export type SubHandler = (...values: any[]) => any;
export type SubDepsHandler = (...params: any[]) => SubVector[];

export interface SubConfig {
  equalityCheck?: EqualityCheckFn;
}
