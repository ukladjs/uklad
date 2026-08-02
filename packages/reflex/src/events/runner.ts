import { type Draft, type Patch } from 'immer';

import { IS_DEV } from '../core/environment';
import {
  containsDraft,
  ensurePatchesEnabled,
  produce,
  produceWithPatches,
  snapshotDrafts,
} from '../core/immer';
import { consoleLog } from '../core/logging';
import { type RuntimeCore } from '../runtime/core';
import { execute } from './interceptors-executor';

import type {
  Context,
  Effects,
  EventCoeffects,
  EventContext,
  EventHandler,
  EventVector,
  InternalInterceptor,
  ReflexError,
  State,
} from '../types';

/** Provider-to-slot projection retained on one named event definition. */
interface NamedCoeffectBinding {
  readonly slot: string;
  readonly id: string;
}

const EMPTY_NAMED_COEFFECT_BINDINGS: readonly NamedCoeffectBinding[] = Object.freeze([]);

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
  const definition = runtime.events.getEvent(eventId);
  if (!definition) {
    return Object.freeze({
      status: 'missing-handler' as const,
      previousState,
      effects: Object.freeze([]),
      invalidEffects: Object.freeze([]),
    });
  }

  const context = execute(runtime, event, definition.chain) as Context & {
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

export function createEventHandlerInterceptor(
  runtime: RuntimeCore,
  handler: EventHandler<any>,
  namedCoeffectBindings: readonly NamedCoeffectBinding[] = EMPTY_NAMED_COEFFECT_BINDINGS,
): InternalInterceptor {
  return {
    id: 'fx-handler',
    before(context: Context) {
      const event = context.coeffects.event;
      const params = event.slice(1);
      let effects: Effects = [];
      let newState: State;

      const recipe = (draftState: Draft<State>) => {
        const eventContext = createEventContext(
          context.coeffects,
          draftState,
          namedCoeffectBindings,
        );
        runtime.events.runningHandlerEventId = event[0];
        try {
          effects = handler(eventContext, ...params) ?? [];
          // Still inside the recipe, so any draft the handler passed along is
          // live and can be snapshotted. After `produce` returns it is revoked.
          effects = snapshotDrafts(effects) as Effects;
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

      // Anything still holding a draft here is a shape snapshotDrafts()
      // deliberately did not walk — inside a collection, or nested deeper than
      // a few plain objects. Never interpolate the effects themselves: such a
      // draft is revoked by now and stringifying it would throw.
      if (IS_DEV && containsDraft(effects)) {
        consoleLog(
          'warn',
          `[reflex] Effects returned by '${String(event[0])}' still contain an Immer draft nested inside a collection or deeply nested object, which the runtime does not unwrap automatically. Drafts are revoked once the handler returns, so the effect handler would receive a dead value. Wrap that value in current() before returning it.`,
        );
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

/**
 * Keep runtime-owned inputs at the top level and group injected values under
 * `coeffects` for event handlers. Named bindings replace provider ids with
 * declared slots, while provider ids stay available to ordered coeffects and
 * infrastructure interceptors inside the pipeline.
 */
function createEventContext(
  pipelineCoeffects: Context['coeffects'],
  draftState: Draft<State>,
  namedCoeffectBindings: readonly NamedCoeffectBinding[],
): EventContext<State> {
  const handlerCoeffects: Record<string, any> = {};
  for (const [id, value] of Object.entries(pipelineCoeffects)) {
    if (id !== 'event' && id !== 'draftState') handlerCoeffects[id] = value;
  }

  if (namedCoeffectBindings.length > 0) {
    for (const binding of namedCoeffectBindings) delete handlerCoeffects[binding.id];
    for (const binding of namedCoeffectBindings) {
      handlerCoeffects[binding.slot] = pipelineCoeffects[binding.id];
    }
  }

  return {
    event: pipelineCoeffects.event,
    draftState,
    coeffects: handlerCoeffects as EventCoeffects,
  };
}
