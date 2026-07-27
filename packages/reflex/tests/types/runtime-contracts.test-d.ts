import { createReflexHooks } from '../../src/react';
import { createReflexRuntimeForTests as createReflexRuntime } from '../../src/runtime/runtime';
import { createReflexTestHarness } from '../../src/testing';
import type { ReflexContracts } from '../../src/vanilla';

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

runtime.regEvent('increment', ({ draftState }, amount) => {
  draftState.count += amount;
  return [['log', { message: String(amount) }]];
});
runtime.regEvent('reset', ({ draftState }) => {
  draftState.count = 0;
});
runtime.regEffect('log', ({ message }) => {
  const value: string = message;
  void value;
});
runtime.regRootSub('count', 'count');
runtime.regSub(
  'scaled',
  (count: number, factor: number) => count * factor,
  (factor) => {
    const value: number = factor;
    void value;
    return [['count']];
  },
);

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
// @ts-expect-error Effect payloads are checked per runtime.
runtime.regEffect('log', (value: number) => void value);

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
