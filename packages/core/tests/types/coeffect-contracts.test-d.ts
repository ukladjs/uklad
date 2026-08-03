/**
 * Compile-time tests for the coeffect contract section.
 *
 * A coeffect contract is keyed by provider id. Events may keep that legacy
 * id-as-key behavior or bind a provider to an ergonomic event-local property.
 * These cases pin both forms, and the permissive behavior an undeclared
 * section keeps.
 *
 * Run with `npm run test:types`.
 */
import { createReflexRuntime } from '../../src/vanilla';
import { createReflexTestHarness } from '../../src/testing';
import type { ReflexContracts } from '../../src/vanilla';

interface Session {
  userId: number;
  token: string;
}

interface AppContracts extends ReflexContracts {
  state: { count: number; lastSeen: number };
  events: {
    tick: [];
    restore: [key: string];
    'session/refresh': [];
  };
  coeffects: {
    now: { arg: void; value: number };
    'system/now': { arg: void; value: number };
    'local-storage-value': { arg: string; value: string | null };
    session: { arg: void; value: Session };
    'random-int': { arg: number | undefined; value: number };
  };
}

const runtime = createReflexRuntime<AppContracts>({
  initialState: { count: 0, lastSeen: 0 },
  runtimeId: 'typed-coeffects',
});

// ---- regCoeffect -----------------------------------------------------
// The handler returns the declared value; the runtime injects it under the id.

runtime.registerModule((registrar) => {
  registrar.regCoeffect('now', () => Date.now());
  registrar.regCoeffect('system/now', () => Date.now());
  registrar.regCoeffect('local-storage-value', (key) => {
    const asString: string = key;
    void asString;
    return null;
  });
  registrar.regCoeffect('session', () => ({ userId: 1, token: 'abc' }));
  // A declared optional argument stays optional at the handler.
  registrar.regCoeffect('random-int', (max) => Math.floor(Math.random() * (max ?? 10)));
});

// The second parameter is a frozen, state-free view of what has been injected
// so far. It can read the event but cannot alter it or access draft state.
runtime.registerModule((registrar) => {
  registrar.regCoeffect('now', (_arg, coeffects) => {
    const [eventId] = coeffects.event;
    // @ts-expect-error The event vector is read-only in a coeffect handler.
    coeffects.event[0] = 'hijacked';
    // @ts-expect-error Event-handler draft state is not exposed to coeffects.
    coeffects.draftState.count += 1;
    return eventId.length;
  });
});

runtime.registerModule((registrar) => {
  // @ts-expect-error 'now' declares a number value, not a string.
  registrar.regCoeffect('now', () => 'not-a-number');
});
runtime.registerModule((registrar) => {
  // @ts-expect-error 'clock' is not a declared coeffect id.
  registrar.regCoeffect('clock', () => Date.now());
});
runtime.registerModule((registrar) => {
  // @ts-expect-error Runtime-owned coeffects cannot be declared or registered.
  registrar.regCoeffect('event', () => ['hijacked']);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error '__proto__' cannot be used as a coeffect id.
  registrar.regCoeffect('__proto__', () => 1);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error 'local-storage-value' is injected with a string argument.
  registrar.regCoeffect('local-storage-value', (key: number) => String(key));
});
runtime.registerModule((registrar) => {
  registrar.regCoeffect('session', (_arg, coeffects) => {
    // @ts-expect-error The injected view is read-only.
    coeffects.session = { userId: 2, token: 'x' };
    return { userId: 1, token: 'abc' };
  });
});

// ---- regEvent injection ----------------------------------------------
// The `coeffects` object is read as a literal binding map, so
// `context.coeffects` carries exactly the local slots this event injects.

runtime.registerModule((registrar) => {
  registrar.regEvent(
    'tick',
    ({ draftState, coeffects: { now } }) => {
      const millis: number = now;
      draftState.lastSeen = millis;
    },
    { coeffects: { now: 'now' } },
  );
});

// Bindings keep the global provider id in the contract and registry,
// while the handler gets only the local property names from this event.
runtime.registerModule((registrar) => {
  registrar.regEvent(
    'restore',
    (context, key) => {
      const { draftState, coeffects } = context;
      const asKey: string = key;
      const stored: string | null = coeffects.stored;
      const now: number = coeffects.now;
      void asKey;
      void stored;
      draftState.lastSeen = now;
      // @ts-expect-error Provider ids are not the named handler properties.
      const providerValue = coeffects['system/now'];
      void providerValue;
      // @ts-expect-error Coeffect values are read-only.
      coeffects.now = 1;
    },
    {
      coeffects: {
        stored: ['local-storage-value', 'todos'],
        now: 'system/now',
      },
    },
  );
});

runtime.registerModule((registrar) => {
  registrar.regEvent(
    'restore',
    ({ draftState, coeffects: { 'local-storage-value': stored, now } }, key) => {
      const asKey: string = key;
      const asStored: string | null = stored;
      const asNow: number = now;
      void asKey;
      void asStored;
      draftState.lastSeen = asNow;
    },
    {
      coeffects: {
        'local-storage-value': ['local-storage-value', 'todos'],
        now: 'now',
      },
    },
  );
});

runtime.registerModule((registrar) => {
  registrar.regEvent(
    'session/refresh',
    ({ draftState, coeffects: { session } }) => {
      draftState.count = session.userId;
    },
    { coeffects: { session: 'session' } },
  );
});

// An event that injects nothing sees only the runtime-owned coeffects.
runtime.registerModule((registrar) => {
  registrar.regEvent('tick', ({ draftState, event }) => {
    const [id] = event;
    draftState.count = id.length;
  });
});

runtime.registerModule((registrar) => {
  registrar.regEvent(
    'tick',
    // @ts-expect-error 'session' was not injected by this registration.
    ({ draftState, coeffects: { session } }) => {
      draftState.count = session.userId;
    },
    { coeffects: { now: 'now' } },
  );
});
runtime.registerModule((registrar) => {
  registrar.regEvent('tick', ({ draftState }) => void draftState, {
    // @ts-expect-error Tuple-list coeffects were removed; use local bindings instead.
    coeffects: [['now']],
  });
});
runtime.registerModule((registrar) => {
  registrar.regEvent('tick', ({ draftState }) => void draftState, {
    coeffects: {
      // @ts-expect-error Bindings validate the provider argument too.
      stored: ['local-storage-value'],
    },
  });
});
runtime.registerModule((registrar) => {
  registrar.regEvent('tick', ({ draftState }) => void draftState, {
    coeffects: {
      // @ts-expect-error A bare provider id cannot omit a required argument.
      stored: 'local-storage-value',
    },
  });
});
runtime.registerModule((registrar) => {
  registrar.regEvent('tick', ({ draftState }) => void draftState, {
    coeffects: {
      // @ts-expect-error Bindings reject an undeclared provider id.
      now: 'clock',
    },
  });
});
runtime.registerModule((registrar) => {
  registrar.regEvent('tick', ({ draftState }) => void draftState, {
    // @ts-expect-error Runtime-owned event inputs cannot become binding slots.
    coeffects: { event: 'system/now' },
  });
});
runtime.registerModule((registrar) => {
  registrar.regEvent('tick', ({ draftState }) => void draftState, {
    coeffects: {
      // @ts-expect-error 'now' declares no argument.
      now: ['now', 5],
    },
  });
});
runtime.registerModule((registrar) => {
  registrar.regEvent('tick', ({ draftState }) => void draftState, {
    coeffects: {
      // @ts-expect-error 'clock' is not a declared coeffect id.
      clock: 'clock',
    },
  });
});
runtime.registerModule((registrar) => {
  registrar.regEvent('tick', ({ draftState }) => void draftState, {
    // @ts-expect-error Runtime-owned coeffects cannot be requested or used as slots.
    coeffects: { draftState: 'now' },
  });
});
runtime.registerModule((registrar) => {
  registrar.regEvent(
    'tick',
    (context) => {
      // @ts-expect-error Injected values are nested under context.coeffects.
      const flatNow = context.now;
      void flatNow;
      // @ts-expect-error Injected coeffect values are read-only.
      context.coeffects.now = 1;
      context.draftState.count += 1;
    },
    { coeffects: { now: 'now' } },
  );
});

// ---- test harness ----------------------------------------------------

const harness = createReflexTestHarness(runtime);
const nowHandler = harness.getCoeffectHandler('now');
if (nowHandler) {
  const millis: number = nowHandler(undefined, { event: ['tick'] } as never);
  void millis;
}
// @ts-expect-error 'clock' is not a declared coeffect id.
harness.getCoeffectHandler('clock');

// ---- undeclared sections stay permissive -----------------------------
// A runtime that declares no coeffects keeps the open shape, so untyped and
// incrementally typed applications are unaffected by the narrowing above.

const untyped = createReflexRuntime({ initialState: { count: 0 } });
untyped.registerModule((registrar) => {
  registrar.regCoeffect('now', () => Date.now());
  registrar.regCoeffect('anything', (arg: string) => arg.length);
  registrar.regEvent(
    'some/event',
    ({ draftState, coeffects: { now, whatever } }) => {
      draftState.count = now + whatever;
    },
    { coeffects: { now: 'now', whatever: ['whatever', 1] } },
  );
  registrar.regEvent('other/event', ({ draftState, coeffects: { notInjected } }) => {
    draftState.count = notInjected;
  });
});

// A contract that declares other sections but no coeffects is open too.
interface PartialContracts extends ReflexContracts {
  state: { count: number };
  events: { bump: [] };
}

const partial = createReflexRuntime<PartialContracts>({ initialState: { count: 0 } });
partial.registerModule((registrar) => {
  registrar.regCoeffect('now', () => Date.now());
  registrar.regEvent(
    'bump',
    ({ draftState, coeffects: { now } }) => {
      draftState.count = now;
    },
    { coeffects: { now: 'now' } },
  );
});
