import type {
  CoEffectHandler,
  EffectHandler,
  ErrorHandler,
  EventHandler,
  SubDepsHandler,
  SubHandler,
} from '../types';

export type HandlerByKind = {
  event: EventHandler<any, any>;
  fx: EffectHandler;
  cofx: CoEffectHandler<any>;
  sub: SubHandler;
  subDeps: SubDepsHandler;
  error: ErrorHandler;
};

export type HandlerKind = keyof HandlerByKind;
export type RegistryHandler = HandlerByKind[HandlerKind];
export type HandlerRegistry = {
  [K in HandlerKind]: Partial<Record<string, HandlerByKind[K]>>;
};

export interface RegistrationOwnership {
  /** True only while this token still owns the current registration. */
  readonly current: boolean;
  /** Validate destructive release before user cleanup runs. */
  assertReleasable?(): void;
  /** Remove this registration without touching a newer replacement. */
  release(): boolean;
}
