import { RegistrationStore } from './registrations';

import type { HandlerRegistry } from './handler-types';
import type {
  CoEffectHandler,
  EffectHandler,
  ErrorHandler,
  EventHandler,
  SubDepsHandler,
  SubHandler,
} from '../types';

export type { HandlerRegistry } from './handler-types';
export type { RegistrationHandle } from './registrations';
export { RegistrationStore } from './registrations';

/**
 * Cohesive handler registry owned eagerly by one runtime core.
 *
 * Every namespace uses the same registration store, so duplicate detection,
 * cleanup handles, and system baselines have one implementation.
 */
export class RuntimeRegistry {
  readonly event: RegistrationStore<EventHandler<any, any>> = new RegistrationStore();
  readonly fx: RegistrationStore<EffectHandler> = new RegistrationStore();
  readonly cofx: RegistrationStore<CoEffectHandler> = new RegistrationStore();
  readonly sub: RegistrationStore<SubHandler> = new RegistrationStore();
  readonly subDeps: RegistrationStore<SubDepsHandler> = new RegistrationStore();
  readonly error: RegistrationStore<ErrorHandler> = new RegistrationStore();

  readonly handlers: HandlerRegistry = {
    event: this.event.values,
    fx: this.fx.values,
    cofx: this.cofx.values,
    sub: this.sub.values,
    subDeps: this.subDeps.values,
    error: this.error.values,
  };

  clear(): void {
    this.event.clear();
    this.fx.clear();
    this.cofx.clear();
    this.sub.clear();
    this.subDeps.clear();
    this.error.clear();
  }
}
