import { produce, produceWithPatches, type Draft, type Patch } from 'immer';

import { IS_DEV } from '../core/environment';
import { ensurePatchesEnabled } from '../core/immer';
import { consoleLog } from '../core/logging';
import { type RuntimeCore } from '../runtime/core';
import { execute } from './interceptors';

import type {
  Context,
  State,
  Effects,
  EventHandler,
  EventVector,
  Interceptor,
  ReflexError,
} from '../types';

/** The result exposed by the event runner, not by the interceptor pipeline. */
export interface EventRunResult {
  readonly status: 'completed' | 'missing-handler' | 'aborted';
  readonly previousState: unknown;
  readonly candidateState?: unknown;
  readonly effects: readonly unknown[];
  readonly invalidEffects: readonly unknown[];
  readonly patches?: readonly Patch[];
  readonly reversePatches?: readonly Patch[];
  readonly error?: unknown;
}

/** Log and rethrow an unhandled event-pipeline exception. */
export function defaultErrorHandler(originalError: Error, reflexError: ReflexError): void {
  consoleLog('error', '[reflex] Interceptor Exception:', {
    originalError,
    reflexError,
    data: reflexError.data,
  });
  throw originalError;
}

/**
 * Run an event through interceptors and its handler without committing state or
 * invoking effects. `Context` is confined to this component.
 */
export function runEvent(runtime: RuntimeCore, event: EventVector): EventRunResult {
  const previousState = runtime.state.get<State>();
  const eventId = event[0];
  const definition = runtime.registry.getEvent(eventId);
  if (!definition) {
    return Object.freeze({
      status: 'missing-handler' as const,
      previousState,
      effects: Object.freeze([]),
      invalidEffects: Object.freeze([]),
    });
  }

  const interceptors = [
    runtime.events.injectGlobalInterceptors,
    ...definition.interceptors,
    createEventHandlerInterceptor(runtime, definition.handler),
  ];

  const context = execute(runtime, event, interceptors) as Context & {
    readonly runtimePatches?: readonly Patch[];
    readonly runtimeReversePatches?: readonly Patch[];
  };
  const finalEffects = Array.isArray(context.effects) ? context.effects : [];
  const invalidEffects = [
    ...(context.invalidEffects ?? []),
    ...(Array.isArray(context.effects) ? [] : [context.effects]),
  ];
  return Object.freeze({
    status: context.newState === undefined ? ('aborted' as const) : ('completed' as const),
    previousState: context.previousState,
    ...(context.newState === undefined ? {} : { candidateState: context.newState }),
    effects: Object.freeze([...finalEffects]),
    invalidEffects: Object.freeze(invalidEffects),
    ...(context.runtimePatches === undefined ? {} : { patches: context.runtimePatches }),
    ...(context.runtimeReversePatches === undefined
      ? {}
      : { reversePatches: context.runtimeReversePatches }),
    ...(context.executionError === undefined ? {} : { error: context.executionError }),
  });
}

function createEventHandlerInterceptor(
  runtime: RuntimeCore,
  handler: EventHandler<any>,
): Interceptor {
  return {
    id: 'fx-handler',
    before(context: Context) {
      const event = context.coeffects.event;
      const params = event.slice(1);
      let effects: Effects = [];
      let newState: State;

      const recipe = (draftState: Draft<State>) => {
        const coeffects = { ...context.coeffects, draftState };
        runtime.events.runningHandlerEventId = event[0];
        try {
          effects = handler(coeffects, ...params) ?? [];
        } finally {
          runtime.events.runningHandlerEventId = null;
        }
      };

      const patchesRequested = runtime.probe?.needsPatches === true;
      let patches: readonly Patch[] | undefined;
      let reversePatches: readonly Patch[] | undefined;
      if (patchesRequested) {
        ensurePatchesEnabled();
        const produced = produceWithPatches(context.previousState as State, recipe);
        newState = produced[0];
        patches = produced[1];
        reversePatches = produced[2];
      } else {
        newState = produce(context.previousState as State, recipe);
      }

      if (IS_DEV) {
        try {
          JSON.stringify(effects);
        } catch {
          consoleLog(
            'warn',
            `[reflex] Effects ${effects} contain Proxy (probably an Immer draft). Use current() for draftState values.`,
          );
        }
      }

      if (!Array.isArray(effects)) {
        return {
          ...context,
          invalidEffects: [...(context.invalidEffects ?? []), effects],
          newState,
          ...(patches === undefined ? {} : { runtimePatches: patches }),
          ...(reversePatches === undefined ? {} : { runtimeReversePatches: reversePatches }),
        };
      }

      const nextEffects = [...(context.effects || []), ...effects];
      return {
        ...context,
        effects: nextEffects,
        newState,
        ...(patches === undefined ? {} : { runtimePatches: patches }),
        ...(reversePatches === undefined ? {} : { runtimeReversePatches: reversePatches }),
      };
    },
  };
}
