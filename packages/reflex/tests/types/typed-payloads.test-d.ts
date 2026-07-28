/**
 * Compile-time tests for the opt-in typed payload maps (EventPayloads /
 * SubPayloads) and the typed app state (AppState). Run with `npm run test:types` —
 * tsc fails if a positive case stops compiling or an `@ts-expect-error` case
 * starts compiling.
 *
 * Consumers of the published package augment '@flexsurfer/reflex' instead of
 * the relative path used here (see tests/types/dist for that variant).
 */
import {
  createReflexHooks,
  createReflexRuntime,
  useSubscription as useUntypedSubscription,
} from '../../src/index';
import { createReflexTestHarness } from '../../src/testing';
import type {
  CoEffects,
  DefaultReflexContracts,
  EventRegistrationOptions,
  EventPayloads,
} from '../../src/index';

interface Todo {
  id: number;
  title: string;
  done: boolean;
}

declare module '../../src/types' {
  interface EventPayloads {
    'todos/add': [title: string];
    'todos/toggle': [id: number];
    'app/init': [];
  }
  interface SubPayloads {
    'todos/all': { params: []; result: Todo[] };
    'todos/by-id': { params: [id: number]; result: Todo | undefined };
  }
  interface EffectPayloads {
    'storage/set-todos': Todo[];
    'ui/scroll-top': void;
    // Accidental built-in declarations are ignored: built-ins keep their
    // reserved payload contracts.
    dispatch: number;
    'dispatch-later': string;
  }
  interface AppState {
    todos: Todo[];
  }
}

const runtime = createReflexRuntime<DefaultReflexContracts>({
  initialState: { todos: [] },
});
const testHarness = createReflexTestHarness(runtime);
const { useSubscription } = createReflexHooks<DefaultReflexContracts>();

// ---- dispatch --------------------------------------------------------

runtime.dispatch(['todos/add', 'buy milk']);
runtime.dispatch(['todos/toggle', 42]);
runtime.dispatch(['app/init']);

// @ts-expect-error unknown event id is rejected once EventPayloads is augmented
runtime.dispatch(['todos/typo', 'x']);
// @ts-expect-error wrong payload type
runtime.dispatch(['todos/add', 42]);
// @ts-expect-error missing payload
runtime.dispatch(['todos/add']);
// @ts-expect-error extra payload
runtime.dispatch(['app/init', 'unexpected']);

// debounce helpers share the dispatch typing
runtime.debounceAndDispatch(['todos/add', 'title'], 100);
runtime.throttleAndDispatch(['app/init'], 100);
// @ts-expect-error unknown event id
runtime.debounceAndDispatch(['todos/typo'], 100);

// dispatchSync shares the dispatch typing
testHarness.dispatchSync(['todos/add', 'buy milk']);
testHarness.dispatchSync(['app/init']);
// @ts-expect-error unknown event id is rejected once EventPayloads is augmented
testHarness.dispatchSync(['todos/typo', 'x']);
// @ts-expect-error wrong payload type
testHarness.dispatchSync(['todos/add', 42]);

// ---- regEvent --------------------------------------------------------

// handler params are inferred from EventPayloads, draftState from AppState —
// no generics needed
runtime.registerModule((registrar) => {
  registrar.regEvent('todos/add', ({ draftState }, title) => {
    const _title: string = title;
    const _first: string | undefined = draftState.todos[0]?.title;
    void _title;
    void _first;
  });
});

const registrationOptions: EventRegistrationOptions = {
  coeffects: [['now']],
  interceptors: [{ id: 'typed-options', before: (context) => context }],
};
runtime.registerModule((registrar) => {
  registrar.regEvent('app/init', () => undefined, registrationOptions);
});

runtime.registerModule((registrar) => {
  // @ts-expect-error registration metadata must use the options object
  registrar.regEvent('app/init', () => undefined, [
    { id: 'positional-interceptor', before: (context: any) => context },
  ]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error the legacy fourth interceptor argument is not supported
  registrar.regEvent('app/init', () => undefined, { coeffects: [] }, []);
});

runtime.registerModule((registrar) => {
  registrar.regEvent('app/init', ({ draftState }) => {
    // @ts-expect-error unknown state key is rejected once AppState is augmented
    draftState.nope = 1;
  });
});

runtime.registerModule((registrar) => {
  // @ts-expect-error handler params must match the declared payload
  registrar.regEvent('todos/add', (_cofx, title: number) => {
    void title;
  });
});

// undeclared ids stay permissive, so internal/bridge events keep working
runtime.registerModule((registrar) => {
  registrar.regEvent('not-in-map', (_cofx, anything: number) => {
    void anything;
  });
});

// A separate runtime can combine a custom state with the event contract.
interface LegacyState {
  anything: string;
}
type LegacyContracts = { state: LegacyState; events: EventPayloads };
const legacyRuntime = createReflexRuntime<LegacyContracts>({
  initialState: { anything: '' },
});
legacyRuntime.registerModule((registrar) => {
  registrar.regEvent('todos/toggle', ({ draftState }: CoEffects<LegacyState>, id) => {
    const _id: number = id;
    const _s: string = draftState.anything;
    void _id;
    void _s;
  });
});

// A separately owned runtime may use a different state contract.
legacyRuntime.registerModule((registrar) => {
  registrar.regEvent('todos/add', ({ draftState }, whatever) => {
    void draftState;
    void whatever;
  });
});

// ---- effects returned from handlers ----------------------------------

// declared effect ids with matching payloads, including the built-in
// dispatch effects whose event vectors are checked against EventPayloads
runtime.registerModule((registrar) => {
  registrar.regEvent('todos/add', ({ draftState }, title) => {
    void draftState;
    void title;
    return [
      ['storage/set-todos', []],
      ['ui/scroll-top'],
      ['dispatch', ['todos/toggle', 1]],
      ['dispatch-later', { ms: 100, dispatch: ['app/init'] }],
    ];
  });
});

runtime.registerModule((registrar) => {
  // @ts-expect-error wrong payload inside a dispatch effect
  registrar.regEvent('app/init', () => [['dispatch', ['todos/add', 42]]]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error unknown event id inside a dispatch effect
  registrar.regEvent('app/init', () => [['dispatch', ['todos/typo']]]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error dispatch-later event vector must match EventPayloads
  registrar.regEvent('app/init', () => [['dispatch-later', { ms: 5, dispatch: ['todos/add', 7] }]]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error built-in dispatch payload still wins over accidental EffectPayloads declaration
  registrar.regEvent('app/init', () => [['dispatch', 1]]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error built-in dispatch-later payload still wins over accidental EffectPayloads declaration
  registrar.regEvent('app/init', () => [['dispatch-later', 'not-a-dispatch-later-payload']]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error undeclared effect id is rejected once EffectPayloads is augmented
  registrar.regEvent('app/init', () => [['storage/unknown', 1]]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error wrong effect payload type
  registrar.regEvent('app/init', () => [['storage/set-todos', 'nope']]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error a void-payload effect takes no payload
  registrar.regEvent('app/init', () => [['ui/scroll-top', 1]]);
});

// ---- regEffect --------------------------------------------------------

// handler value param inferred from EffectPayloads
runtime.registerModule((registrar) => {
  registrar.regEffect('storage/set-todos', (todos) => {
    const _t: Todo[] = todos;
    void _t;
  });
});
runtime.registerModule((registrar) => {
  // @ts-expect-error handler param must match the declared payload
  registrar.regEffect('storage/set-todos', (n: number) => {
    void n;
  });
});
// undeclared ids stay permissive
runtime.registerModule((registrar) => {
  registrar.regEffect('undeclared-effect', (anything: number) => {
    void anything;
  });
});

// ---- getState / initState --------------------------------------------

const state = testHarness.getState();
const _all: Todo[] = state.todos;
void _all;

const legacyState = createReflexTestHarness(legacyRuntime).getState();
const _s2: string = legacyState.anything;
void _s2;

// ---- useSubscription -------------------------------------------------

const todos = useSubscription(['todos/all']);
const _todos: Todo[] = todos;
void _todos;

const one = useSubscription(['todos/by-id', 1]);
const _one: Todo | undefined = one;
void _one;

// legacy explicit result generic still compiles for declared ids
const legacy = useUntypedSubscription<Todo[]>(['todos/all']);
void legacy;

// @ts-expect-error unknown sub id is rejected once SubPayloads is augmented
useSubscription(['subs/typo']);
// @ts-expect-error wrong param type
useSubscription(['todos/by-id', 'not-a-number']);
// @ts-expect-error missing param
useSubscription(['todos/by-id']);

// ---- getSubscriptionValue --------------------------------------------

const all: Todo[] = testHarness.getSubscriptionValue(['todos/all']);
void all;
// @ts-expect-error unknown sub id
testHarness.getSubscriptionValue(['subs/typo']);

// ---- regSub ----------------------------------------------------------

// computeFn result is checked against the declared sub result
runtime.registerModule((registrar) => {
  registrar.regSub(
    'todos/all',
    () => [],
    (): Todo[] => [],
  );
});
runtime.registerModule((registrar) => {
  registrar.regSub(
    'todos/all',
    () => [],
    // @ts-expect-error computeFn result must match the declared sub result
    (): number => 42,
  );
});

// Root subs use their own registration API.
runtime.registerModule((registrar) => {
  registrar.regRootSub('some-root', 'some-root');
});
runtime.registerModule((registrar) => {
  // @ts-expect-error root subscriptions require an explicit source key
  registrar.regRootSub('some-root');
});
runtime.registerModule((registrar) => {
  // @ts-expect-error regSub only registers computed subscriptions
  registrar.regSub('some-root');
});
runtime.registerModule((registrar) => {
  // @ts-expect-error source-key subscriptions use regRootSub
  registrar.regSub('some-root', 'state-key');
});
legacyRuntime.registerModule((registrar) => {
  registrar.regSub(
    'legacy-sorted',
    () => [],
    () => [] as Todo[],
  );
});
