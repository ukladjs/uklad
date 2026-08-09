import { createUkladHooks } from '../../src/react';
import { createUkladRuntime } from '../../src/vanilla';
import { createUkladTestHarness } from '../../src/testing';
import type { UkladContracts } from '../../src/vanilla';

interface CounterContracts extends UkladContracts {
  state: { count: number };
  events: {
    increment: [amount: number];
    reset: [];
  };
  effects: {
    log: { message: string };
  };
  subscriptions: {
    count: { params: []; result: number };
    scaled: { params: [factor: number]; result: number };
  };
}

const runtime = createUkladRuntime<CounterContracts>({
  initialState: { count: 0 },
  runtimeId: 'typed-counter',
});
const testHarness = createUkladTestHarness(runtime);

runtime.registerModule((registrar) => {
  registrar.regEvent('increment', ({ draftState }, amount) => {
    draftState.count += amount;
    return [['log', { message: String(amount) }]];
  });
});
runtime.registerModule((registrar) => {
  registrar.regEvent('reset', ({ draftState }) => {
    draftState.count = 0;
  });
});
runtime.registerModule((registrar) => {
  registrar.regEffect('log', ({ message }) => {
    const value: string = message;
    void value;
  });
});
runtime.registerModule((registrar) => {
  registrar.regRootSub('count', 'count');
});
runtime.registerModule((registrar) => {
  registrar.regSub(
    'scaled',
    (factor) => {
      const value: number = factor;
      void value;
      return [['count']];
    },
    ([count], factor) => count * factor,
  );
});

// ---- regSubExt lifecycle typing --------------------------------------

interface ResourceContracts extends UkladContracts {
  state: { selectedId: number; selectedLabel: string };
  subscriptions: {
    'selected/id': { params: []; result: number };
    'selected/label': { params: []; result: string };
  };
}

const resourceRuntime = createUkladRuntime<ResourceContracts>({
  initialState: { selectedId: 1, selectedLabel: '1' },
});
resourceRuntime.registerModule((registrar) => {
  registrar.regRootSub('selected/id', 'selectedId');
  registrar.regRootSub('selected/label', 'selectedLabel');
  registrar.regSubExt(
    'selected/label',
    () => [['selected/id']],
    (context) => ({
      sync: ([id]) => {
        const checkedId: number = id;
        void checkedId;
        context.updateRoot('selectedLabel', () => String(id));
        // @ts-expect-error updateRoot addresses state keys, not subscription ids.
        context.updateRoot('selected/label', () => String(id));
        // @ts-expect-error The updater must return the selected state key's value type.
        context.updateRoot('selectedId', () => String(id));
      },
      dispose: () => {},
    }),
  );
});

resourceRuntime.registerModule((registrar) => {
  registrar.regSubExt(
    'selected/label',
    () => [['selected/id']],
    () => ({
      // @ts-expect-error Extension sync values follow the declared signal tuple.
      sync: ([id]: [string]) => void id,
      dispose: () => {},
    }),
  );
});

// ---- regSub dependency inference -------------------------------------
// `compute` receives the dependency values as one array, in declaration order,
// followed by the subscription's own parameters. All of it is inferred from the
// dependency function's returned tuple.

interface GraphContracts extends UkladContracts {
  state: { todos: Todo[]; showing: Showing };
  subscriptions: {
    todos: { params: []; result: Todo[] };
    showing: { params: []; result: Showing };
    visible: { params: []; result: Todo[] };
    byId: { params: [id: number]; result: Todo | undefined };
  };
}

interface Todo {
  id: number;
  done: boolean;
}
type Showing = 'all' | 'active' | 'done';

const graph = createUkladRuntime<GraphContracts>({
  initialState: { todos: [], showing: 'all' },
  runtimeId: 'typed-graph',
});

// Dependency values are inferred without annotations.
graph.registerModule((registrar) => {
  registrar.regSub(
    'visible',
    () => [['todos'], ['showing']],
    ([todos, showing]) => (showing === 'all' ? todos : todos.filter((todo) => todo.done)),
  );
});

// Reordering dependencies is a compile-time error rather than a silent swap.
graph.registerModule((registrar) => {
  registrar.regSub(
    'visible',
    () => [['showing'], ['todos']],
    // @ts-expect-error deps resolve to [Showing, Todo[]], not [Todo[], Showing].
    ([todos, showing]: [Todo[], Showing]) => (showing === 'all' ? todos : []),
  );
});

// Subscription parameters follow the dependency array, and keep their position
// no matter how many dependencies are declared.
graph.registerModule((registrar) => {
  registrar.regSub(
    'byId',
    () => [['todos']],
    ([todos], id) => todos.find((todo) => todo.id === id),
  );
});
graph.registerModule((registrar) => {
  registrar.regSub(
    'byId',
    () => [['todos'], ['showing']],
    ([todos, showing], id) =>
      showing === 'all' ? todos.find((todo) => todo.id === id) : undefined,
  );
});

// Dependency inference survives a dependency function that takes parameters.
graph.registerModule((registrar) => {
  registrar.regSub(
    'byId',
    (id) => (id > 0 ? [['todos'], ['showing']] : [['todos'], ['showing']]),
    ([todos, showing], id) =>
      showing === 'all' ? todos.find((todo) => todo.id === id) : undefined,
  );
});

// Unknown dependency ids are rejected.
graph.registerModule((registrar) => {
  registrar.regSub(
    'visible',
    // @ts-expect-error 'missing' is not a declared subscription id.
    () => [['missing']],
    ([todos]) => todos as Todo[],
  );
});

// A dependency list the compiler cannot see as a fixed tuple stays a plain
// array instead of failing to compile.
graph.registerModule((registrar) => {
  registrar.regSub(
    'visible',
    // A widening annotation an application could write itself, with no
    // package-internal helper type involved.
    () => [['todos'], ['showing']].slice(0, 1) as [id: 'todos'][],
    (values) => values[0] as Todo[],
  );
});

// ---- regRootSub id/source-key pairing --------------------------------
// A root subscription publishes one state key unchanged, so both halves are
// checked against the contract: the id must declare no parameters, and the
// key's declared type must satisfy that subscription's declared result.

graph.registerModule((registrar) => {
  registrar.regRootSub('todos', 'todos');
  registrar.regRootSub('showing', 'showing');
});

// The pairing is by type, not by name: any state key carrying the declared
// result is accepted.
graph.registerModule((registrar) => {
  registrar.regRootSub('visible', 'todos');
});

graph.registerModule((registrar) => {
  // @ts-expect-error 'showing' holds a Showing, not the declared Todo[] result.
  registrar.regRootSub('todos', 'showing');
});
graph.registerModule((registrar) => {
  // @ts-expect-error 'byId' declares a parameter, and root subscriptions take none.
  registrar.regRootSub('byId', 'todos');
});
graph.registerModule((registrar) => {
  // @ts-expect-error 'absent' is not a key of the declared state.
  registrar.regRootSub('todos', 'absent');
});
graph.registerModule((registrar) => {
  // @ts-expect-error 'todos/typo' is not a declared subscription id.
  registrar.regRootSub('todos/typo', 'todos');
});

// The pair is checked together, so an id only known to be one of several
// subscriptions cannot borrow a key valid for just one of them.
declare const eitherId: 'todos' | 'showing';
graph.registerModule((registrar) => {
  // @ts-expect-error No key satisfies both a `Todo[]` and a `Showing` result.
  registrar.regRootSub(eitherId, 'todos');
});

// A union whose members agree on the result is sound, and stays allowed.
declare const eitherTodoList: 'todos' | 'visible';
graph.registerModule((registrar) => {
  registrar.regRootSub(eitherTodoList, 'todos');
});

// A typed index signature declares what every key it admits holds, so it is
// checked against the subscription result like a named key would be — while a
// narrower named property still wins at its own key.

interface IndexedContracts extends UkladContracts {
  state: { [key: string]: number | string; total: number };
  subscriptions: {
    total: { params: []; result: number };
    entry: { params: []; result: number | string };
  };
}

const indexed = createUkladRuntime<IndexedContracts>({ initialState: { total: 0 } });
indexed.registerModule((registrar) => {
  // `entry` declares the full index value, so any key backs it.
  registrar.regRootSub('entry', 'any-key');
  // `total` is declared `number`, narrower than the index value it sits behind.
  registrar.regRootSub('total', 'total');
});
indexed.registerModule((registrar) => {
  // @ts-expect-error Other keys hold `number | string`, too wide for a `number` result.
  registrar.regRootSub('total', 'any-key');
});

// A union state is only ever one of its variants, so a root subscription needs
// a key every variant declares. `keyof` over a union keeps only the shared
// keys, which would leave a disjoint state looking undeclared.

interface UnionStateContracts extends UkladContracts {
  state:
    | { status: 'loading'; items: readonly string[] }
    | { status: 'ready'; items: readonly string[]; error: string };
  subscriptions: {
    items: { params: []; result: readonly string[] };
    error: { params: []; result: string };
  };
}

const union = createUkladRuntime<UnionStateContracts>({
  initialState: { status: 'loading', items: [] },
});
union.registerModule((registrar) => {
  // `items` is declared by both variants.
  registrar.regRootSub('items', 'items');
});
union.registerModule((registrar) => {
  // @ts-expect-error `error` exists only on the `ready` variant.
  registrar.regRootSub('error', 'error');
});

// A subscription section is open or closed on the same terms as the state. An
// index signature declares what every id it admits accepts, so one requiring
// parameters leaves no id a root subscription can serve.

interface ParameterizedSubContracts extends UkladContracts {
  state: { value: number };
  subscriptions: Record<string, { params: [factor: number]; result: number }>;
}

const parameterized = createUkladRuntime<ParameterizedSubContracts>({
  initialState: { value: 0 },
});
parameterized.registerModule((registrar) => {
  // @ts-expect-error Every permitted query carries a parameter a root sub rejects.
  registrar.regRootSub('scaled', 'value');
});

// A named entry under an open index signature is read through its own
// declaration rather than the index signature's.
interface MixedSubContracts extends UkladContracts {
  state: { value: number };
  subscriptions: {
    [id: string]: { params: readonly any[]; result: any };
    scaled: { params: [factor: number]; result: number };
  };
}

const mixedSubs = createUkladRuntime<MixedSubContracts>({ initialState: { value: 0 } });
mixedSubs.registerModule((registrar) => {
  registrar.regRootSub('plain', 'value');
});
mixedSubs.registerModule((registrar) => {
  // @ts-expect-error `scaled` declares a parameter of its own.
  registrar.regRootSub('scaled', 'value');
});

// Typed arrays and variadic tuples still describe parameter-bearing queries;
// only the permissive `any[]` fallback is open to root registrations.
interface ArrayParamContracts extends UkladContracts {
  state: { value: number };
  subscriptions: {
    many: { params: number[]; result: number };
    atLeastOne: { params: [first: number, ...rest: number[]]; result: number };
  };
}

const arrayParams = createUkladRuntime<ArrayParamContracts>({ initialState: { value: 0 } });
arrayParams.registerModule((registrar) => {
  // @ts-expect-error A typed array permits argument-bearing queries.
  registrar.regRootSub('many', 'value');
  // @ts-expect-error A variadic tuple requires at least one argument.
  registrar.regRootSub('atLeastOne', 'value');
});

// A union-valued index cannot promise an arbitrary id is parameterless, but a
// narrower named entry can still make that promise for itself.
interface UnionIndexSubContracts extends UkladContracts {
  state: { value: number };
  subscriptions: {
    [id: string]: { params: []; result: number } | { params: [factor: number]; result: number };
    plain: { params: []; result: number };
  };
}

const unionIndexSubs = createUkladRuntime<UnionIndexSubContracts>({ initialState: { value: 0 } });
unionIndexSubs.registerModule((registrar) => {
  registrar.regRootSub('plain', 'value');
});
unionIndexSubs.registerModule((registrar) => {
  // @ts-expect-error The index does not guarantee that an arbitrary id is parameterless.
  registrar.regRootSub('other', 'value');
});

// A state may declare a numeric key; `state['0']` and `state[0]` are one
// property at runtime, so the numeric-string source resolves onto it.

interface NumericKeyContracts extends UkladContracts {
  state: { 0: string };
  subscriptions: {
    first: { params: []; result: string };
    counted: { params: []; result: number };
  };
}

const numeric = createUkladRuntime<NumericKeyContracts>({ initialState: { 0: '' } });
numeric.registerModule((registrar) => {
  registrar.regRootSub('first', '0');
});
numeric.registerModule((registrar) => {
  // @ts-expect-error Key `0` holds a string, not the number `counted` declares.
  registrar.regRootSub('counted', '0');
});
numeric.registerModule((registrar) => {
  // @ts-expect-error The state is declared, so an unknown key is still rejected.
  registrar.regRootSub('first', 'absent');
});

// Only the canonical string form of a numeric key names the same JavaScript
// property. Constrained template inference also accepts strings like `01` by
// widening the inferred value to `number`, so the contract requires a round trip.
interface NumberIndexedStateContracts extends UkladContracts {
  state: Record<number, string>;
  subscriptions: { first: { params: []; result: string } };
}

const numberIndexed = createUkladRuntime<NumberIndexedStateContracts>({
  initialState: { 1: 'one' },
});
numberIndexed.registerModule((registrar) => {
  registrar.regRootSub('first', '1');
});
numberIndexed.registerModule((registrar) => {
  // @ts-expect-error `01` is a distinct string property rather than numeric key `1`.
  registrar.regRootSub('first', '01');
  // @ts-expect-error Exponent notation does not name the runtime property `1`.
  registrar.regRootSub('first', '1e0');
  // @ts-expect-error The string `-0` is distinct from the numeric key `0`.
  registrar.regRootSub('first', '-0');
});

runtime.dispatch(['increment', 2]);
runtime.dispatch(['reset']);
const count: number = testHarness.getSubscriptionValue(['count']);
const scaled: number = testHarness.getSubscriptionValue(['scaled', 3]);
void count;
void scaled;

// @ts-expect-error Event payloads are checked per runtime.
runtime.dispatch(['increment', 'two']);
// @ts-expect-error Unknown events are rejected by a non-empty event contract.
runtime.dispatch(['missing']);
// @ts-expect-error Subscription parameters are checked per runtime.
testHarness.getSubscriptionValue(['scaled', 'three']);
runtime.registerModule((registrar) => {
  // @ts-expect-error Effect payloads are checked per runtime.
  registrar.regEffect('log', (value: number) => void value);
});

const hooks = createUkladHooks<CounterContracts>();
const hookResult: number = hooks.useSubscription(['scaled', 2]);
void hookResult;
// @ts-expect-error Locally typed hooks reject invalid subscription params.
hooks.useSubscription(['scaled', 'two']);

const inferred = createUkladRuntime({ initialState: { ready: true } });
const ready: boolean = createUkladTestHarness(inferred).getState().ready;
void ready;

// Undeclared contract sections stay permissive, so the pairing above narrows a
// declared contract without closing the incrementally typed entry points.
//
// A state inferred from `initialState` is open rather than closed: it resolves
// through `Record<string, any>`, whose index signature already lets an event
// handler write an undeclared key. Source keys follow that same state type, so
// they stay open here too — it is the declared contract above, not inference,
// that pins a root subscription to one property.
inferred.registerModule((registrar) => {
  registrar.regRootSub('app/ready', 'ready');
});
inferred.registerModule((registrar) => {
  registrar.regRootSub('app/anything', 'not-in-initial-state');
});

// A runtime that declares no state at all accepts any pair, which is what the
// untyped entry points and JavaScript consumers rely on.
const untyped = createUkladRuntime({ initialState: {} });
untyped.registerModule((registrar) => {
  registrar.regRootSub('any/sub', 'any-key');
});

// @ts-expect-error Runtime states must be top-level object records.
createUkladRuntime({ initialState: null });
// @ts-expect-error Runtime states must be top-level object records.
createUkladRuntime({ initialState: 1 });
// @ts-expect-error Runtime states must not be top-level arrays.
createUkladRuntime({ initialState: [] });
// @ts-expect-error Runtime ids are strings at both typed and JavaScript boundaries.
createUkladRuntime({ initialState: {}, runtimeId: 1 });
// @ts-expect-error Runtime names are strings at both typed and JavaScript boundaries.
createUkladRuntime({ initialState: {}, name: 1 });
