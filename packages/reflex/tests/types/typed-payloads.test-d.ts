/**
 * Compile-time tests for the opt-in typed payload maps (EventPayloads /
 * SubPayloads) and the typed app db (AppDb). Run with `npm run test:types` —
 * tsc fails if a positive case stops compiling or an `@ts-expect-error` case
 * starts compiling.
 *
 * Consumers of the published package augment '@flexsurfer/reflex' instead of
 * the relative path used here (see tests/types/dist for that variant).
 */
import {
  dispatch,
  dispatchSync,
  regEvent,
  regEffect,
  regSub,
  getSubscriptionValue,
  useSubscription,
  debounceAndDispatch,
  throttleAndDispatch,
  getAppDb,
  initAppDb,
} from '../../src/index';
import type { CoEffects, EventRegistrationOptions } from '../../src/index';

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
  interface AppDb {
    todos: Todo[];
  }
}

// ---- dispatch --------------------------------------------------------

dispatch(['todos/add', 'buy milk']);
dispatch(['todos/toggle', 42]);
dispatch(['app/init']);

// @ts-expect-error unknown event id is rejected once EventPayloads is augmented
dispatch(['todos/typo', 'x']);
// @ts-expect-error wrong payload type
dispatch(['todos/add', 42]);
// @ts-expect-error missing payload
dispatch(['todos/add']);
// @ts-expect-error extra payload
dispatch(['app/init', 'unexpected']);

// debounce helpers share the dispatch typing
debounceAndDispatch(['todos/add', 'title'], 100);
throttleAndDispatch(['app/init'], 100);
// @ts-expect-error unknown event id
debounceAndDispatch(['todos/typo'], 100);

// dispatchSync shares the dispatch typing
dispatchSync(['todos/add', 'buy milk']);
dispatchSync(['app/init']);
// @ts-expect-error unknown event id is rejected once EventPayloads is augmented
dispatchSync(['todos/typo', 'x']);
// @ts-expect-error wrong payload type
dispatchSync(['todos/add', 42]);

// ---- regEvent --------------------------------------------------------

// handler params are inferred from EventPayloads, draftDb from AppDb —
// no generics needed
regEvent('todos/add', ({ draftDb }, title) => {
  const _title: string = title;
  const _first: string | undefined = draftDb.todos[0]?.title;
  void _title;
  void _first;
});

const registrationOptions: EventRegistrationOptions = {
  coeffects: [['now']],
  interceptors: [{ id: 'typed-options', before: (context) => context }],
};
regEvent('app/init', () => undefined, registrationOptions);

regEvent('app/init', ({ draftDb }) => {
  // @ts-expect-error unknown db key is rejected once AppDb is augmented
  draftDb.nope = 1;
});

// @ts-expect-error handler params must match the declared payload
regEvent('todos/add', (_cofx, title: number) => {
  void title;
});

// undeclared ids stay permissive, so internal/bridge events keep working
regEvent('not-in-map', (_cofx, anything: number) => {
  void anything;
});

// a custom db type via inline coeffects annotation still combines with
// payload inference
interface LegacyDb {
  anything: string;
}
regEvent('todos/toggle', ({ draftDb }: CoEffects<LegacyDb>, id) => {
  const _id: number = id;
  const _s: string = draftDb.anything;
  void _id;
  void _s;
});

// legacy explicit-db-generic call keeps compiling (params become untyped)
regEvent<LegacyDb>('todos/add', ({ draftDb }, whatever) => {
  void draftDb;
  void whatever;
});

// ---- effects returned from handlers ----------------------------------

// declared effect ids with matching payloads, including the built-in
// dispatch effects whose event vectors are checked against EventPayloads
regEvent('todos/add', ({ draftDb }, title) => {
  void draftDb;
  void title;
  return [
    ['storage/set-todos', []],
    ['ui/scroll-top'],
    ['dispatch', ['todos/toggle', 1]],
    ['dispatch-later', { ms: 100, dispatch: ['app/init'] }],
  ];
});

// @ts-expect-error wrong payload inside a dispatch effect
regEvent('app/init', () => [['dispatch', ['todos/add', 42]]]);
// @ts-expect-error unknown event id inside a dispatch effect
regEvent('app/init', () => [['dispatch', ['todos/typo']]]);
// @ts-expect-error dispatch-later event vector must match EventPayloads
regEvent('app/init', () => [['dispatch-later', { ms: 5, dispatch: ['todos/add', 7] }]]);
// @ts-expect-error built-in dispatch payload still wins over accidental EffectPayloads declaration
regEvent('app/init', () => [['dispatch', 1]]);
// @ts-expect-error built-in dispatch-later payload still wins over accidental EffectPayloads declaration
regEvent('app/init', () => [['dispatch-later', 'not-a-dispatch-later-payload']]);
// @ts-expect-error undeclared effect id is rejected once EffectPayloads is augmented
regEvent('app/init', () => [['storage/unknown', 1]]);
// @ts-expect-error wrong effect payload type
regEvent('app/init', () => [['storage/set-todos', 'nope']]);
// @ts-expect-error a void-payload effect takes no payload
regEvent('app/init', () => [['ui/scroll-top', 1]]);

// ---- regEffect --------------------------------------------------------

// handler value param inferred from EffectPayloads
regEffect('storage/set-todos', (todos) => {
  const _t: Todo[] = todos;
  void _t;
});
// @ts-expect-error handler param must match the declared payload
regEffect('storage/set-todos', (n: number) => {
  void n;
});
// undeclared ids stay permissive
regEffect('undeclared-effect', (anything: number) => {
  void anything;
});

// ---- getAppDb / initAppDb --------------------------------------------

const db = getAppDb();
const _all: Todo[] = db.todos;
void _all;

initAppDb({ todos: [] });
// @ts-expect-error initial state must match the augmented AppDb
initAppDb({});

// legacy explicit generic keeps working
const legacyDb = getAppDb<LegacyDb>();
const _s2: string = legacyDb.anything;
void _s2;

// ---- useSubscription -------------------------------------------------

const todos = useSubscription(['todos/all']);
const _todos: Todo[] = todos;
void _todos;

const one = useSubscription(['todos/by-id', 1]);
const _one: Todo | undefined = one;
void _one;

// legacy explicit result generic still compiles for declared ids
const legacy = useSubscription<Todo[]>(['todos/all']);
void legacy;

// @ts-expect-error unknown sub id is rejected once SubPayloads is augmented
useSubscription(['subs/typo']);
// @ts-expect-error wrong param type
useSubscription(['todos/by-id', 'not-a-number']);
// @ts-expect-error missing param
useSubscription(['todos/by-id']);

// ---- getSubscriptionValue --------------------------------------------

const all: Todo[] = getSubscriptionValue(['todos/all']);
void all;
// @ts-expect-error unknown sub id
getSubscriptionValue(['subs/typo']);

// ---- regSub ----------------------------------------------------------

// computeFn result is checked against the declared sub result
regSub(
  'todos/all',
  (): Todo[] => [],
  () => [],
);
regSub(
  'todos/all',
  // @ts-expect-error computeFn result must match the declared sub result
  (): number => 42,
  () => [],
);

// root subs and undeclared ids keep working
regSub('some-root');
regSub<Todo[]>(
  'legacy-sorted',
  () => [] as Todo[],
  () => [],
);
