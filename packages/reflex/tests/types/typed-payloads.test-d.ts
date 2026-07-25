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
runtime.dispatchSync(['todos/add', 'buy milk']);
runtime.dispatchSync(['app/init']);
// @ts-expect-error unknown event id is rejected once EventPayloads is augmented
runtime.dispatchSync(['todos/typo', 'x']);
// @ts-expect-error wrong payload type
runtime.dispatchSync(['todos/add', 42]);

// ---- regEvent --------------------------------------------------------

// handler params are inferred from EventPayloads, draftState from AppState —
// no generics needed
runtime.regEvent('todos/add', ({ draftState }, title) => {
  const _title: string = title;
  const _first: string | undefined = draftState.todos[0]?.title;
  void _title;
  void _first;
});

const registrationOptions: EventRegistrationOptions = {
  coeffects: [['now']],
  interceptors: [{ id: 'typed-options', before: (context) => context }],
};
runtime.regEvent('app/init', () => undefined, registrationOptions);

// @ts-expect-error registration metadata must use the options object
runtime.regEvent('app/init', () => undefined, [
  { id: 'positional-interceptor', before: (context: any) => context },
]);
// @ts-expect-error the legacy fourth interceptor argument is not supported
runtime.regEvent('app/init', () => undefined, { coeffects: [] }, []);

runtime.regEvent('app/init', ({ draftState }) => {
  // @ts-expect-error unknown state key is rejected once AppState is augmented
  draftState.nope = 1;
});

// @ts-expect-error handler params must match the declared payload
runtime.regEvent('todos/add', (_cofx, title: number) => {
  void title;
});

// undeclared ids stay permissive, so internal/bridge events keep working
runtime.regEvent('not-in-map', (_cofx, anything: number) => {
  void anything;
});

// A separate runtime can combine a custom state with the event contract.
interface LegacyState {
  anything: string;
}
type LegacyContracts = { state: LegacyState; events: EventPayloads };
const legacyRuntime = createReflexRuntime<LegacyContracts>({
  initialState: { anything: '' },
});
legacyRuntime.regEvent('todos/toggle', ({ draftState }: CoEffects<LegacyState>, id) => {
  const _id: number = id;
  const _s: string = draftState.anything;
  void _id;
  void _s;
});

// A separately owned runtime may use a different state contract.
legacyRuntime.regEvent('todos/add', ({ draftState }, whatever) => {
  void draftState;
  void whatever;
});

// ---- effects returned from handlers ----------------------------------

// declared effect ids with matching payloads, including the built-in
// dispatch effects whose event vectors are checked against EventPayloads
runtime.regEvent('todos/add', ({ draftState }, title) => {
  void draftState;
  void title;
  return [
    ['storage/set-todos', []],
    ['ui/scroll-top'],
    ['dispatch', ['todos/toggle', 1]],
    ['dispatch-later', { ms: 100, dispatch: ['app/init'] }],
  ];
});

// @ts-expect-error wrong payload inside a dispatch effect
runtime.regEvent('app/init', () => [['dispatch', ['todos/add', 42]]]);
// @ts-expect-error unknown event id inside a dispatch effect
runtime.regEvent('app/init', () => [['dispatch', ['todos/typo']]]);
// @ts-expect-error dispatch-later event vector must match EventPayloads
runtime.regEvent('app/init', () => [['dispatch-later', { ms: 5, dispatch: ['todos/add', 7] }]]);
// @ts-expect-error built-in dispatch payload still wins over accidental EffectPayloads declaration
runtime.regEvent('app/init', () => [['dispatch', 1]]);
// @ts-expect-error built-in dispatch-later payload still wins over accidental EffectPayloads declaration
runtime.regEvent('app/init', () => [['dispatch-later', 'not-a-dispatch-later-payload']]);
// @ts-expect-error undeclared effect id is rejected once EffectPayloads is augmented
runtime.regEvent('app/init', () => [['storage/unknown', 1]]);
// @ts-expect-error wrong effect payload type
runtime.regEvent('app/init', () => [['storage/set-todos', 'nope']]);
// @ts-expect-error a void-payload effect takes no payload
runtime.regEvent('app/init', () => [['ui/scroll-top', 1]]);

// ---- regEffect --------------------------------------------------------

// handler value param inferred from EffectPayloads
runtime.regEffect('storage/set-todos', (todos) => {
  const _t: Todo[] = todos;
  void _t;
});
// @ts-expect-error handler param must match the declared payload
runtime.regEffect('storage/set-todos', (n: number) => {
  void n;
});
// undeclared ids stay permissive
runtime.regEffect('undeclared-effect', (anything: number) => {
  void anything;
});

// ---- getState / initState --------------------------------------------

const state = runtime.getState();
const _all: Todo[] = state.todos;
void _all;

runtime.restoreState({ todos: [] });
// @ts-expect-error initial state must match the augmented AppState
runtime.restoreState({});

const legacyState = legacyRuntime.getState();
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

const all: Todo[] = runtime.getSubscriptionValue(['todos/all']);
void all;
// @ts-expect-error unknown sub id
runtime.getSubscriptionValue(['subs/typo']);

// ---- regSub ----------------------------------------------------------

// computeFn result is checked against the declared sub result
runtime.regSub(
  'todos/all',
  (): Todo[] => [],
  () => [],
);
runtime.regSub(
  'todos/all',
  // @ts-expect-error computeFn result must match the declared sub result
  (): number => 42,
  () => [],
);

// root subs and undeclared ids keep working
runtime.regSub('some-root');
legacyRuntime.regSub(
  'legacy-sorted',
  () => [] as Todo[],
  () => [],
);
