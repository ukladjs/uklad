import { consoleLog } from '../core/logging';
import type { RegistrationOwnership } from '../runtime/handler-types';
import type { RuntimeCore } from '../runtime/core';
import { getInjectCofxInterceptor } from './coeffects';
import { isInterceptor } from './interceptors';

import type { EventHandler, Id, Interceptor } from '../types';

interface UnknownEventRegistrationOptions {
  coeffects?: unknown;
  interceptors?: unknown;
}

interface NormalizedEventRegistration {
  coeffects: readonly unknown[];
  interceptors: readonly unknown[];
}

/** @internal Register an event and its metadata in one runtime. */
export function regEvent<T = Record<string, any>>(
  runtime: RuntimeCore,
  id: Id,
  handler: EventHandler<T>,
  registration?: unknown,
  legacyInterceptors?: Interceptor<T>[],
): RegistrationOwnership {
  const interceptors = buildEventInterceptors(runtime, id, registration, legacyInterceptors);
  return runtime.registry.registerEvent(id, handler, interceptors);
}

function isCoeffectSpecificationArray(value: readonly unknown[]): boolean {
  return value.length > 0 && Array.isArray(value[0]);
}

function isEventRegistrationOptions(value: unknown): value is UnknownEventRegistrationOptions {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeEventRegistration(
  registration: unknown,
  legacyInterceptors?: readonly unknown[],
): NormalizedEventRegistration {
  if (isEventRegistrationOptions(registration)) {
    return {
      coeffects: Array.isArray(registration.coeffects) ? registration.coeffects : [],
      interceptors: Array.isArray(registration.interceptors) ? registration.interceptors : [],
    };
  }

  // A fourth argument disambiguates an empty third argument as coeffects.
  if (legacyInterceptors !== undefined) {
    return {
      coeffects: Array.isArray(registration) ? registration : [],
      interceptors: legacyInterceptors,
    };
  }

  if (!Array.isArray(registration)) {
    return { coeffects: [], interceptors: [] };
  }

  return isCoeffectSpecificationArray(registration)
    ? { coeffects: registration, interceptors: [] }
    : { coeffects: [], interceptors: registration };
}

function buildEventInterceptors<T = Record<string, any>>(
  runtime: RuntimeCore,
  id: Id,
  registration: unknown,
  legacyInterceptors?: readonly Interceptor<T>[],
): readonly Interceptor[] {
  const normalized = normalizeEventRegistration(registration, legacyInterceptors);
  const coeffectInterceptors: Interceptor[] = [];

  for (const specification of normalized.coeffects) {
    if (!Array.isArray(specification) || typeof specification[0] !== 'string') {
      consoleLog('warn', '[reflex] invalid cofx specification:', specification);
      continue;
    }

    if (specification.length === 1) {
      coeffectInterceptors.push(getInjectCofxInterceptor(runtime, specification[0]));
    } else if (specification.length === 2) {
      coeffectInterceptors.push(
        getInjectCofxInterceptor(runtime, specification[0], specification[1]),
      );
    } else {
      consoleLog('warn', '[reflex] invalid cofx specification:', specification);
    }
  }

  const eventInterceptors: Interceptor[] = [];
  for (const candidate of normalized.interceptors) {
    if (isInterceptor(candidate)) {
      eventInterceptors.push(candidate);
    } else {
      consoleLog(
        'error',
        '[reflex] invalid interceptor provided for event:',
        id,
        'interceptor:',
        candidate,
      );
    }
  }

  // Registration replaces metadata; an empty list must clear prior metadata.
  return [...coeffectInterceptors, ...eventInterceptors];
}
