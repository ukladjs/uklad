import { createUkladHooks } from '../../src/react';
import { createUkladRuntime } from '../../src/vanilla';

import type { UkladBindings, UkladHooks } from '../../src/react';
import type { UkladContracts } from '../../src/vanilla';

// Two contracts that share a subscription id with different result types. This
// is the pairing the locally typed bindings exist to enforce: a hook created
// for one of them must not be able to read a runtime built for the other, or
// its inferred result type would be a claim the runtime does not honor.
interface CounterContracts extends UkladContracts {
  state: { count: number };
  events: { bump: [amount: number] };
  subscriptions: {
    count: { params: []; result: number };
    scaled: { params: [factor: number]; result: number };
  };
}

// Deliberately identical in state and events, so the only thing that can
// separate the two runtimes is the subscription section itself.
interface LabelContracts extends UkladContracts {
  state: { count: number };
  events: { bump: [amount: number] };
  subscriptions: {
    count: { params: []; result: string };
  };
}

const counterRuntime = createUkladRuntime<CounterContracts>({
  initialState: { count: 0 },
  runtimeId: 'counter',
});
const labelRuntime = createUkladRuntime<LabelContracts>({
  initialState: { count: 0 },
  runtimeId: 'label',
});

const counter = createUkladHooks<CounterContracts>();
const label = createUkladHooks<LabelContracts>();

// ---- the provider is checked against the contract it was created with ----

counter.UkladProvider({ runtime: counterRuntime });
label.UkladProvider({ runtime: labelRuntime });

// @ts-expect-error a runtime built for another contract cannot select these bindings
counter.UkladProvider({ runtime: labelRuntime });
// @ts-expect-error the mismatch is symmetric
label.UkladProvider({ runtime: counterRuntime });

// ---- hooks keep their per-contract checking ------------------------------

const count: number = counter.useSubscription(['count']);
const scaled: number = counter.useSubscription(['scaled', 2]);
const labelCount: string = label.useSubscription(['count']);
void count;
void scaled;
void labelCount;

// The shared id resolves per contract rather than per hook name.
// @ts-expect-error 'count' is a string under this contract
const mistypedLabel: number = label.useSubscription(['count']);
void mistypedLabel;

// @ts-expect-error subscription parameters are still checked
counter.useSubscription(['scaled', 'two']);
// @ts-expect-error unknown subscription ids are still rejected
counter.useSubscription(['missing']);

// ---- the bound runtime carries the same contract -------------------------

const runtime = counter.useRuntime();
runtime.dispatch(['bump', 1]);
// @ts-expect-error dispatch payloads are checked against the bound contract
runtime.dispatch(['bump', 'one']);

// ---- UkladHooks keeps its published shape -------------------------------

// A value supplying only `useSubscription` still satisfies `UkladHooks`, which
// is what existing annotations and test doubles were written against. Widening
// it to require the provider would break them at their declaration site.
const hooksDouble: UkladHooks<CounterContracts> = {
  useSubscription: () => 0 as never,
};
const doubledCount: number = hooksDouble.useSubscription(['count']);
void doubledCount;

// The full bindings remain usable everywhere the hooks alone are expected.
const asHooks: UkladHooks<CounterContracts> = counter;
void asHooks;

const bindings: UkladBindings<CounterContracts> = counter;
void bindings;

// @ts-expect-error the hooks alone do not carry the provider
const asBindings: UkladBindings<CounterContracts> = hooksDouble;
void asBindings;
