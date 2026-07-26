import type {
  CoEffectHandler,
  EffectHandler,
  ErrorHandler,
  EventHandler,
  SubDepsHandler,
  SubHandler,
} from '../types';

export type HandlerRegistry = {
  event: Partial<Record<string, EventHandler<any, any>>>;
  fx: Partial<Record<string, EffectHandler>>;
  cofx: Partial<Record<string, CoEffectHandler<any>>>;
  sub: Partial<Record<string, SubHandler>>;
  subDeps: Partial<Record<string, SubDepsHandler>>;
  error: Partial<Record<string, ErrorHandler>>;
};

export interface RegistrationOwnership {
  /** True only while this token still owns the current registration. */
  readonly current: boolean;
  /** Validate destructive release before user cleanup runs. */
  assertReleasable?(): void;
  /** Remove this registration without touching a newer replacement. */
  release(): boolean;
}
