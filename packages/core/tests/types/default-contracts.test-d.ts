/**
 * Compile-time tests for the ambient `DefaultContracts` anchor.
 *
 * `DefaultContracts` is a `UkladContracts`, not a parallel type system: the
 * same declaration is usable as an explicit type argument. What it adds is a
 * binding for the package-level entry points that cannot take one — chiefly
 * `useSubscription`, since a React context type is fixed at creation.
 *
 * Run with `npm run test:types` — tsc fails if a positive case stops compiling
 * or an `@ts-expect-error` case starts compiling. Consumers of the published
 * package augment '@ukladjs/core' instead of the relative path used here
 * (see tests/types/dist for that variant).
 */
import { createUkladHooks, createUkladRuntime, useSubscription } from '../../src/index';
import { createUkladTestHarness } from '../../src/testing';
import type { CoEffects, DefaultContracts, EventRegistrationOptions } from '../../src/index';

interface Todo {
  id: number;
  title: string;
  done: boolean;
}

declare module '../../src/contracts' {
  interface DefaultContracts {
    state: { todos: Todo[] };
    events: {
      'todos/add': [title: string];
      'todos/toggle': [id: number];
      'app/init': [];
    };
    effects: {
      'storage/set-todos': Todo[];
      'ui/scroll-top': void;
    };
    subscriptions: {
      'todos/all': { params: []; result: Todo[] };
      'todos/by-id': { params: [id: number]; result: Todo | undefined };
    };
  }
}

// The ambient declaration is a normal contract: usable as a type argument.
const runtime = createUkladRuntime<DefaultContracts>({ initialState: { todos: [] } });
const testHarness = createUkladTestHarness(runtime);

// ---- dispatch --------------------------------------------------------

runtime.dispatch(['todos/add', 'buy milk']);
runtime.dispatch(['todos/toggle', 1]);
runtime.dispatch(['app/init']);

// @ts-expect-error payload type is checked
runtime.dispatch(['todos/add', 1]);
// @ts-expect-error unknown event id
runtime.dispatch(['todos/typo', 'x']);
// @ts-expect-error declared as parameterless
runtime.dispatch(['app/init', 1]);
// @ts-expect-error missing required payload
runtime.dispatch(['todos/add']);

// ---- the package-level hook resolves against the anchor --------------

const all: Todo[] = useSubscription(['todos/all']);
const one: Todo | undefined = useSubscription(['todos/by-id', 7]);
void all;
void one;

// @ts-expect-error unknown subscription id
useSubscription(['todos/typo']);
// @ts-expect-error subscription parameter type is checked
useSubscription(['todos/by-id', 'seven']);
// @ts-expect-error required subscription parameter is missing
useSubscription(['todos/by-id']);

// Locally typed hooks stay available and agree with the ambient anchor.
const local = createUkladHooks<DefaultContracts>();
const alsoAll: Todo[] = local.useSubscription(['todos/all']);
void alsoAll;

// ---- registration ----------------------------------------------------

runtime.registerModule((registrar) => {
  registrar.regEvent('todos/add', ({ draftState }, title) => {
    const checked: string = title;
    void checked;
    draftState.todos.push({ id: 1, title, done: false });
    return [['storage/set-todos', draftState.todos]];
  });
});

runtime.registerModule((registrar) => {
  // @ts-expect-error effect payload type is checked against the anchor
  registrar.regEvent('app/init', () => [['storage/set-todos', 'not-todos']]);
});

runtime.registerModule((registrar) => {
  // `ui/scroll-top` is declared void, so it takes no payload.
  registrar.regEvent('app/init', () => [['ui/scroll-top']]);
});

runtime.registerModule((registrar) => {
  registrar.regRootSub('todos/all', 'todos');
  registrar.regSub(
    'todos/by-id',
    () => [['todos/all']],
    ([todos], id) => todos.find((todo) => todo.id === id),
  );
});

// ---- state and coeffects ---------------------------------------------

const state: { todos: Todo[] } = testHarness.getState();
void state;

const coeffects: CoEffects<{ todos: Todo[] }> = {
  event: ['app/init'],
  draftState: { todos: [] },
};
void coeffects;

const options: EventRegistrationOptions<{ todos: Todo[] }> = { coeffects: { now: 'now' } };
void options;

// ---- built-in dispatch effects keep their reserved contracts ----------

runtime.registerModule((registrar) => {
  registrar.regEvent('app/init', () => [['dispatch', ['todos/toggle', 1]]]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error the dispatch effect carries a declared event vector
  registrar.regEvent('app/init', () => [['dispatch', ['todos/typo']]]);
});
runtime.registerModule((registrar) => {
  registrar.regEvent('app/init', () => [['dispatch-later', { ms: 10, dispatch: ['app/init'] }]]);
});
