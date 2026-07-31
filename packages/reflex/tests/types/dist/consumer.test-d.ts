/**
 * Compile-time regression test against the BUILT package types
 * (dist/index.d.mts), resolved as '@flexsurfer/reflex' via a paths mapping —
 * exactly how a consumer sees it. This guards the augmentation contract:
 * tsup's dts rollup must keep DefaultContracts declared (not
 * just re-exported) in the entry module, or `declare module
 * '@flexsurfer/reflex'` stops merging.
 *
 * Run with `npm run test:types:dist` (requires a fresh `npm run build`);
 * wired into prepublishOnly after the build step.
 */
import { createReflexRuntime } from '@flexsurfer/reflex';
import { createReflexTestHarness } from '@flexsurfer/reflex/testing';
import type {
  ContractNamedEventRegistrationOptions,
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

interface NamedContracts extends ReflexContracts {
  readonly state: {
    todos: Todo[];
  };
  readonly events: {
    'named/read': [];
  };
  readonly coeffects: {
    'system/now': { arg: void; value: number };
    'storage/value': { arg: string; value: string | null };
  };
}

const runtime = createReflexRuntime<TestContracts>({ initialState: { todos: [] as Todo[] } });
const testHarness = createReflexTestHarness(runtime);
runtime.dispatch(['todos/add', 'buy milk']);
runtime.dispatch(['app/init']);
// @ts-expect-error unknown event id
runtime.dispatch(['todos/oops']);
// @ts-expect-error wrong payload type
runtime.dispatch(['todos/add', 1]);
// @ts-expect-error missing payload
runtime.dispatch(['todos/add']);

// dispatchSync shares the dispatch typing
testHarness.dispatchSync(['todos/add', 'buy milk']);
// @ts-expect-error unknown event id
testHarness.dispatchSync(['todos/oops']);

runtime.registerModule((registrar) => {
  registrar.regEvent('todos/add', ({ draftState }, title) => {
    const _title: string = title;
    const _first: string | undefined = draftState.todos[0]?.title;
    void _title; void _first;
  });
});
const registrationOptions: EventRegistrationOptions<{ todos: Todo[] }> = {
  coeffects: { now: 'now' },
  interceptors: [{ id: 'dist-options', before: (context) => context }],
};
runtime.registerModule((registrar) => {
  registrar.regEvent('app/init', () => undefined, registrationOptions);
});
const looseNamedRegistrationOptions: EventRegistrationOptions<{ todos: Todo[] }> = {
  coeffects: { now: 'system/now' },
};
runtime.registerModule((registrar) => {
  registrar.regEvent(
    'app/init',
    ({ coeffects: { now } }) => void now,
    looseNamedRegistrationOptions,
  );
});
const namedRuntime = createReflexRuntime<NamedContracts>({
  initialState: { todos: [] as Todo[] },
});
namedRuntime.registerModule((registrar) => {
  registrar.regEvent(
    'named/read',
    (context) => {
      const { coeffects } = context;
      const now: number = coeffects.now;
      const stored: string | null = coeffects.stored;
      void now;
      void stored;
      // @ts-expect-error Provider ids are not named handler properties.
      const providerValue = coeffects['system/now'];
      void providerValue;
    },
    { coeffects: { now: 'system/now', stored: ['storage/value', 'todos'] } },
  );
});
const namedRegistrationOptions: ContractNamedEventRegistrationOptions<
  NamedContracts,
  { readonly now: 'system/now' }
> = {
  coeffects: { now: 'system/now' },
};
namedRuntime.registerModule((registrar) => {
  registrar.regEvent('named/read', ({ coeffects: { now } }) => void now, namedRegistrationOptions);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error unknown state key
  registrar.regEvent('app/init', ({ draftState }) => { draftState.nope = 1; });
});

// effect tuples are checked, including events embedded in dispatch effects
runtime.registerModule((registrar) => {
  registrar.regEvent('app/init', ({ draftState }) => [
    ['storage/set-todos', draftState.todos],
    ['dispatch', ['todos/add', 'from effect']]
  ]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error wrong payload inside a dispatch effect
  registrar.regEvent('app/init', () => [['dispatch', ['todos/add', 1]]]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error undeclared effect id
  registrar.regEvent('app/init', () => [['storage/unknown', 1]]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error built-in dispatch payload still wins over an accidental effect declaration
  registrar.regEvent('app/init', () => [['dispatch', 1]]);
});
runtime.registerModule((registrar) => {
  // @ts-expect-error built-in dispatch-later payload still wins over an accidental effect declaration
  registrar.regEvent('app/init', () => [['dispatch-later', 'not-a-dispatch-later-payload']]);
});

const todos = testHarness.getSubscriptionValue(['todos/all']);
const _check: Todo[] = todos;
void _check;
// @ts-expect-error unknown sub id
useSubscription(['todos/nope']);

const state = testHarness.getState();
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
