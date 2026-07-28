import { createReflexHooks } from '../../src/react';
import { createReflexRuntime } from '../../src/vanilla';
import { createReflexTestHarness } from '../../src/testing';
import type { ContractSubscribeVector, ReflexContracts } from '../../src/vanilla';

interface CounterContracts extends ReflexContracts {
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

const runtime = createReflexRuntime<CounterContracts>({
  initialState: { count: 0 },
  runtimeId: 'typed-counter',
});
const testHarness = createReflexTestHarness(runtime);

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

// ---- regSub dependency inference -------------------------------------
// `compute` receives the dependency values as one array, in declaration order,
// followed by the subscription's own parameters. All of it is inferred from the
// dependency function's returned tuple.

interface GraphContracts extends ReflexContracts {
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

const graph = createReflexRuntime<GraphContracts>({
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
    () => [['todos'], ['showing']].slice(0, 1) as ContractSubscribeVector<GraphContracts>[],
    (values) => values[0] as Todo[],
  );
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

const hooks = createReflexHooks<CounterContracts>();
const hookResult: number = hooks.useSubscription(['scaled', 2]);
void hookResult;
// @ts-expect-error Locally typed hooks reject invalid subscription params.
hooks.useSubscription(['scaled', 'two']);

const inferred = createReflexRuntime({ initialState: { ready: true } });
const ready: boolean = createReflexTestHarness(inferred).getState().ready;
void ready;

// @ts-expect-error Runtime states must be top-level object records.
createReflexRuntime({ initialState: null });
// @ts-expect-error Runtime states must be top-level object records.
createReflexRuntime({ initialState: 1 });
// @ts-expect-error Runtime states must not be top-level arrays.
createReflexRuntime({ initialState: [] });
// @ts-expect-error Runtime ids are strings at both typed and JavaScript boundaries.
createReflexRuntime({ initialState: {}, runtimeId: 1 });
// @ts-expect-error Runtime names are strings at both typed and JavaScript boundaries.
createReflexRuntime({ initialState: {}, name: 1 });
