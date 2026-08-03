/**
 * Every type reachable from a public signature must itself be nameable.
 *
 * `EventRegistrationOptions.interceptors` puts `Interceptor` on the public
 * surface, `Interceptor` puts `InterceptorContext` there, and `ErrorHandler`
 * pulls in `ReflexError` -> `InterceptorErrorData` -> `InterceptorDirection`.
 * Exporting only the outermost name compiles fine for inline callbacks but
 * blocks the case these types exist for: writing a reusable, separately
 * declared interceptor or error handler.
 *
 * This suite imports only from the package entrypoint, so a type dropped from
 * the export list fails here rather than in a consumer's project.
 */
import { createReflexRuntime } from '../../src/vanilla';
import type {
  ErrorHandler,
  ReflexContracts,
  EventRegistrationOptions,
  Interceptor,
  InterceptorContext,
  InterceptorDirection,
  InterceptorErrorData,
  ReflexError,
} from '../../src/vanilla';

interface AppState extends Record<string, any> {
  audited: number;
}

// A state-typed interceptor composes with a runtime whose contract declares
// that same state. `Interceptor<T>` is invariant in `T` — it appears in both
// the parameter and the return of `before`/`after` — so the unparameterized
// `Interceptor` is the portable form for runtimes without a state contract.
interface AuditContracts extends ReflexContracts {
  state: AppState;
}

// ---- a reusable interceptor declared away from its registration ----------

function withAudit(label: string): Interceptor<AppState> {
  return {
    id: `audit/${label}`,
    comment: 'Records that the event was seen.',
    after: (context) => {
      const [eventId] = context.coeffects.event;
      void eventId;
      void context.previousState;
      void context.newState;
      return context;
    },
  };
}

// The callback parameter is nameable on its own, which is what a shared helper
// between several interceptors needs.
function readEventId(context: InterceptorContext<AppState>): string {
  return String(context.coeffects.event[0]);
}

const auditing: Interceptor<AppState> = {
  id: 'audit/shared',
  after: (context) => {
    void readEventId(context);
    return context;
  },
};

// ---- a reusable error handler, and the error shape it receives -----------

function describeFailure(data: InterceptorErrorData): string {
  const direction: InterceptorDirection = data.direction;
  return `${data.interceptor}:${direction}:${data.originalError.message}`;
}

const reportFailures: ErrorHandler = (originalError: Error, reflexError: ReflexError) => {
  void originalError.message;
  void describeFailure(reflexError.data);
  void reflexError.cause;
};

// ---- and both compose into the public registration surface --------------

const options: EventRegistrationOptions<AppState> = {
  coeffects: { now: 'now' },
  interceptors: [withAudit('events'), auditing],
};

const namedOptions: EventRegistrationOptions<AppState> = {
  coeffects: { now: 'system/now' },
  interceptors: [withAudit('named-events')],
};

const runtime = createReflexRuntime<AuditContracts>({ initialState: { audited: 0 } });
runtime.registerModule((registrar) => {
  registrar.regEvent(
    'audit/bump',
    ({ draftState }) => {
      draftState.audited += 1;
    },
    options,
  );
  registrar.regEvent(
    'audit/named-bump',
    ({ draftState, coeffects: { now } }) => {
      draftState.audited += now;
    },
    namedOptions,
  );
});

void reportFailures;
