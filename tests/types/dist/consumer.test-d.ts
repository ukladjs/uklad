/**
 * Compile-time regression test against the BUILT package types
 * (dist/index.d.ts), resolved as '@flexsurfer/reflex' via a paths mapping —
 * exactly how a consumer sees it. This guards the augmentation contract:
 * tsup's dts rollup must keep EventPayloads/SubPayloads/AppDb declared (not
 * just re-exported) in the entry module, or `declare module
 * '@flexsurfer/reflex'` stops merging.
 *
 * Run with `npm run test:types:dist` (requires a fresh `npm run build`);
 * wired into prepublishOnly after the build step.
 */
import { dispatch, dispatchSync, regEvent, useSubscription, getAppDb } from '@flexsurfer/reflex';
import type { SubscriptionDiagnostic } from '@flexsurfer/reflex';

interface Todo { id: number; title: string; done: boolean }

declare module '@flexsurfer/reflex' {
  interface EventPayloads {
    'todos/add': [title: string];
    'app/init': [];
  }
  interface SubPayloads {
    'todos/all': { params: []; result: Todo[] };
  }
  interface EffectPayloads {
    'storage/set-todos': Todo[];
    'dispatch': number;
    'dispatch-later': string;
  }
  interface AppDb {
    todos: Todo[];
  }
}

dispatch(['todos/add', 'buy milk']);
dispatch(['app/init']);
// @ts-expect-error unknown event id
dispatch(['todos/oops']);
// @ts-expect-error wrong payload type
dispatch(['todos/add', 1]);
// @ts-expect-error missing payload
dispatch(['todos/add']);

// dispatchSync shares the dispatch typing
dispatchSync(['todos/add', 'buy milk']);
// @ts-expect-error unknown event id
dispatchSync(['todos/oops']);

regEvent('todos/add', ({ draftDb }, title) => {
  const _title: string = title;
  const _first: string | undefined = draftDb.todos[0]?.title;
  void _title; void _first;
});
// @ts-expect-error unknown db key
regEvent('app/init', ({ draftDb }) => { draftDb.nope = 1; });

// effect tuples are checked, including events embedded in dispatch effects
regEvent('app/init', ({ draftDb }) => [
  ['storage/set-todos', draftDb.todos],
  ['dispatch', ['todos/add', 'from effect']]
]);
// @ts-expect-error wrong payload inside a dispatch effect
regEvent('app/init', () => [['dispatch', ['todos/add', 1]]]);
// @ts-expect-error undeclared effect id
regEvent('app/init', () => [['storage/unknown', 1]]);
// @ts-expect-error built-in dispatch payload still wins over accidental EffectPayloads declaration
regEvent('app/init', () => [['dispatch', 1]]);
// @ts-expect-error built-in dispatch-later payload still wins over accidental EffectPayloads declaration
regEvent('app/init', () => [['dispatch-later', 'not-a-dispatch-later-payload']]);

const todos = useSubscription(['todos/all']);
const _check: Todo[] = todos;
void _check;
// @ts-expect-error unknown sub id
useSubscription(['todos/nope']);

const db = getAppDb();
const _all: Todo[] = db.todos;
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
