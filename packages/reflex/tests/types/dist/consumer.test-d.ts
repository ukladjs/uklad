/**
 * Compile-time regression test against the BUILT package types
 * (dist/index.d.mts), resolved as '@flexsurfer/reflex' via a paths mapping —
 * exactly how a consumer sees it. This guards the augmentation contract:
 * tsup's dts rollup must keep EventPayloads/SubPayloads/AppState declared (not
 * just re-exported) in the entry module, or `declare module
 * '@flexsurfer/reflex'` stops merging.
 *
 * Run with `npm run test:types:dist` (requires a fresh `npm run build`);
 * wired into prepublishOnly after the build step.
 */
import { createReflexRuntime } from '@flexsurfer/reflex';
import type {
  EventRegistrationOptions,
  ReflexContracts,
  SubscriptionDiagnostic,
} from '@flexsurfer/reflex';

interface Todo { id: number; title: string; done: boolean }

interface TestContracts extends ReflexContracts {
  readonly state: {
    todos: Todo[];
  };
  readonly events: {
    'todos/add': [title: string];
    'app/init': [];
  };
  readonly subscriptions: {
    'todos/all': { params: []; result: Todo[] };
  };
  readonly effects: {
    'storage/set-todos': Todo[];
    'dispatch': number;
    'dispatch-later': string;
  };
}

const runtime = createReflexRuntime<TestContracts>({ initialState: { todos: [] as Todo[] } });
runtime.dispatch(['todos/add', 'buy milk']);
runtime.dispatch(['app/init']);
// @ts-expect-error unknown event id
runtime.dispatch(['todos/oops']);
// @ts-expect-error wrong payload type
runtime.dispatch(['todos/add', 1]);
// @ts-expect-error missing payload
runtime.dispatch(['todos/add']);

// dispatchSync shares the dispatch typing
runtime.dispatchSync(['todos/add', 'buy milk']);
// @ts-expect-error unknown event id
runtime.dispatchSync(['todos/oops']);

runtime.regEvent('todos/add', ({ draftState }, title) => {
  const _title: string = title;
  const _first: string | undefined = draftState.todos[0]?.title;
  void _title; void _first;
});
const registrationOptions: EventRegistrationOptions<{ todos: Todo[] }> = {
  coeffects: [['now']],
  interceptors: [{ id: 'dist-options', before: (context) => context }],
};
runtime.regEvent('app/init', () => undefined, registrationOptions);
// @ts-expect-error unknown state key
runtime.regEvent('app/init', ({ draftState }) => { draftState.nope = 1; });

// effect tuples are checked, including events embedded in dispatch effects
runtime.regEvent('app/init', ({ draftState }) => [
  ['storage/set-todos', draftState.todos],
  ['dispatch', ['todos/add', 'from effect']]
]);
// @ts-expect-error wrong payload inside a dispatch effect
runtime.regEvent('app/init', () => [['dispatch', ['todos/add', 1]]]);
// @ts-expect-error undeclared effect id
runtime.regEvent('app/init', () => [['storage/unknown', 1]]);
// @ts-expect-error built-in dispatch payload still wins over accidental EffectPayloads declaration
runtime.regEvent('app/init', () => [['dispatch', 1]]);
// @ts-expect-error built-in dispatch-later payload still wins over accidental EffectPayloads declaration
runtime.regEvent('app/init', () => [['dispatch-later', 'not-a-dispatch-later-payload']]);

const todos = runtime.getSubscriptionValue(['todos/all']);
const _check: Todo[] = todos;
void _check;
// @ts-expect-error unknown sub id
useSubscription(['todos/nope']);

const state = runtime.getState();
const _all: Todo[] = state.todos;
void _all;

const diagnostic: SubscriptionDiagnostic = {
  key: '["todos/all"]',
  query: ['todos/all'],
  kind: 'computed',
  active: true,
  version: 1,
  status: 'value',
  value: todos,
};
void diagnostic;
