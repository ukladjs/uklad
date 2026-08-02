import type {
  ContractState,
  ContractDispatchVector,
  ContractEffectVector,
  ContractEventId,
  ContractEventParams,
  ContractRootSubscriptionId,
  ContractRootSubscriptionSource,
  ContractRootSubscriptionSubject,
  ContractSubscribeVector,
  ContractSubscriptionId,
  ContractSubscriptionParams,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  PermissiveReflexContracts,
  ReflexContracts,
  SubscriptionParam,
} from '../../src/contracts';
import { createReflexRuntime } from '../../src/vanilla';

interface CounterContracts extends ReflexContracts {
  state: { count: number };
  events: {
    set: [value: number];
    reset: [];
  };
  effects: {
    log: { value: number };
    ping: void;
  };
  subscriptions: {
    value: { params: []; result: number };
    multiplied: { params: [factor: number]; result: number };
  };
}

interface SessionContracts extends ReflexContracts {
  state: { value: string };
  events: {
    set: [value: string];
  };
  subscriptions: {
    value: { params: []; result: string };
  };
}

interface ContractRuntime<TContracts extends ReflexContracts> {
  getState(): ContractState<TContracts>;
  dispatch(event: ContractDispatchVector<TContracts>): void;
  emit(effect: ContractEffectVector<TContracts>): void;
  getSubscriptionValue<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
  ): ContractSubscriptionResult<TContracts, TId>;
}

// ---- scalar subscription parameters ----------------------------------
// A declared subscription query is a cache key, not a data transport. The
// public scalar type permits the values JSON cache keys preserve unambiguously;
// finite-number validation remains an application-boundary concern.
const stringSubscriptionParam: SubscriptionParam = 'todo-1';
const numberSubscriptionParam: SubscriptionParam = 3;
const booleanSubscriptionParam: SubscriptionParam = true;
const nullSubscriptionParam: SubscriptionParam = null;
void stringSubscriptionParam;
void numberSubscriptionParam;
void booleanSubscriptionParam;
void nullSubscriptionParam;

// @ts-expect-error Object values are not scalar subscription parameters.
const objectSubscriptionParam: SubscriptionParam = { id: 'todo-1' };
// @ts-expect-error `undefined` would collide with a parameterless JSON key.
const undefinedSubscriptionParam: SubscriptionParam = undefined;
void objectSubscriptionParam;
void undefinedSubscriptionParam;

interface ScalarParameterContracts extends ReflexContracts {
  subscriptions: {
    filtered: {
      params: [id: string, limit: number, includeDone: boolean, cursor: null];
      result: number;
    };
  };
}

interface InvalidScalarParameterContracts extends ReflexContracts {
  subscriptions: {
    filtered: { params: [filter: { includeDone: boolean }]; result: number };
  };
}

declare const scalarParameterRuntime: ContractRuntime<ScalarParameterContracts>;
declare const invalidScalarParameterRuntime: ContractRuntime<InvalidScalarParameterContracts>;
scalarParameterRuntime.getSubscriptionValue(['filtered', 'todo-1', 10, false, null]);
// @ts-expect-error An invalid contract cannot produce a subscription query vector.
invalidScalarParameterRuntime.getSubscriptionValue(['filtered', { includeDone: true }]);
// @ts-expect-error Typed runtime construction rejects non-scalar contract parameters.
createReflexRuntime<InvalidScalarParameterContracts>({ initialState: {} });
void scalarParameterRuntime;
void invalidScalarParameterRuntime;

declare const counter: ContractRuntime<CounterContracts>;
declare const session: ContractRuntime<SessionContracts>;

counter.dispatch(['set', 1]);
counter.dispatch(['reset']);
session.dispatch(['set', 'ready']);

// @ts-expect-error Counter and session runtimes keep distinct payload contracts.
counter.dispatch(['set', 'ready']);
// @ts-expect-error Counter and session runtimes keep distinct payload contracts.
session.dispatch(['set', 1]);
// @ts-expect-error Unknown events are rejected by a non-empty local event map.
counter.dispatch(['missing']);
// @ts-expect-error `reset` has no payload.
counter.dispatch(['reset', 1]);

const counterState: { count: number } = counter.getState();
const sessionState: { value: string } = session.getState();
void counterState;
void sessionState;

counter.emit(['log', { value: 1 }]);
counter.emit(['ping']);
counter.emit(['dispatch', ['set', 2]]);
counter.emit(['dispatch-later', { ms: 10, dispatch: ['reset'] }]);

// @ts-expect-error Custom effect payloads are local to the counter runtime.
counter.emit(['log', { value: 'wrong' }]);
// @ts-expect-error Built-in dispatch effects use the same local event contract.
counter.emit(['dispatch', ['set', 'wrong']]);
// @ts-expect-error Declaring effects makes unknown returned effect IDs invalid.
counter.emit(['unknown-effect']);

const count: number = counter.getSubscriptionValue(['value']);
const multiplied: number = counter.getSubscriptionValue(['multiplied', 3]);
const sessionValue: string = session.getSubscriptionValue(['value']);
void count;
void multiplied;
void sessionValue;

// @ts-expect-error Subscription results remain specific to each runtime contract.
const wrongCounterResult: string = counter.getSubscriptionValue(['value']);
// @ts-expect-error Subscription parameters are checked locally.
counter.getSubscriptionValue(['multiplied', 'three']);
// @ts-expect-error Missing subscription parameters are rejected.
counter.getSubscriptionValue(['multiplied']);
// @ts-expect-error Unknown subscriptions are rejected by a non-empty local map.
session.getSubscriptionValue(['missing']);
void wrongCounterResult;

type CounterEventIds = ContractEventId<CounterContracts>;
type CounterSetParams = ContractEventParams<CounterContracts, 'set'>;
type CounterSubIds = ContractSubscriptionId<CounterContracts>;
type CounterMultiplyParams = ContractSubscriptionParams<CounterContracts, 'multiplied'>;
type CounterQueries = ContractSubscribeVector<CounterContracts>;

const counterEventId: CounterEventIds = 'set';
const counterSetParams: CounterSetParams = [1];
const counterSubId: CounterSubIds = 'multiplied';
const counterMultiplyParams: CounterMultiplyParams = [2];
const counterQuery: CounterQueries = ['multiplied', 2];
void counterEventId;
void counterSetParams;
void counterSubId;
void counterMultiplyParams;
void counterQuery;

// ---- root subscription pairing ---------------------------------------
// A root subscription reads one state key straight through, so it is defined
// by the parameterless subscription ids and, for one of them, whether a given
// state key holds a value satisfying that subscription's declared result.

interface DashboardContracts extends ReflexContracts {
  state: { count: number; label: string; other: number };
  subscriptions: {
    count: { params: []; result: number };
    label: { params: []; result: string };
    other: { params: []; result: number };
    scaled: { params: [factor: number]; result: number };
  };
}

type DashboardRootSubIds = ContractRootSubscriptionId<DashboardContracts>;
/** The `sourceKey` parameter as `regRootSub` instantiates it. */
type DashboardSource<TId extends string, TKey extends string> = ContractRootSubscriptionSource<
  DashboardContracts,
  TId,
  TKey
>;

const dashboardRootSubId: DashboardRootSubIds = 'label';
const dashboardCountSource: DashboardSource<'count', 'count'> = 'count';
void dashboardRootSubId;
void dashboardCountSource;

// @ts-expect-error `scaled` declares a parameter, so no root subscription serves it.
const parameterizedRootSubId: DashboardRootSubIds = 'scaled';
// @ts-expect-error `label` holds a string, not the number `count` declares.
const mistypedCountSource: DashboardSource<'count', 'label'> = 'label';
// @ts-expect-error The dashboard state declares no `absent` key.
const absentCountSource: DashboardSource<'count', 'absent'> = 'absent';
void parameterizedRootSubId;
void mistypedCountSource;
void absentCountSource;

// Both halves are distributed and every combination must hold, so a union id
// is accepted only with a key valid for each of its members.
const compatibleUnionSource: DashboardSource<'count' | 'other', 'count'> = 'count';
void compatibleUnionSource;

// @ts-expect-error No key satisfies both a `number` and a `string` result.
const mismatchedUnionSource: DashboardSource<'count' | 'label', 'count'> = 'count';
void mismatchedUnionSource;

// Undeclared sections leave both halves open.
const permissiveRootSubId: ContractRootSubscriptionId<PermissiveReflexContracts> = 'any/sub';
const permissiveSource: ContractRootSubscriptionSource<
  PermissiveReflexContracts,
  'any/sub',
  'any-key'
> = 'any-key';
void permissiveRootSubId;
void permissiveSource;

// ---- index signatures -------------------------------------------------
// An open key set is not an unchecked one. `Record<string, any>` carries no
// type to check a result against, but a typed index signature declares what
// every key it admits holds — and a narrower named property still wins at its
// own key, which is why the key is resolved rather than enumerated.

interface AnyIndexedContracts extends ReflexContracts {
  state: Record<string, any>;
  subscriptions: { count: { params: []; result: number } };
}
interface TypedIndexedContracts extends ReflexContracts {
  state: Record<string, number | string>;
  subscriptions: {
    count: { params: []; result: number };
    either: { params: []; result: number | string };
  };
}
interface MixedIndexedContracts extends ReflexContracts {
  state: { [key: string]: number | string; count: number };
  subscriptions: {
    count: { params: []; result: number };
    either: { params: []; result: number | string };
  };
}

const anyIndexedSource: ContractRootSubscriptionSource<AnyIndexedContracts, 'count', 'any-key'> =
  'any-key';
void anyIndexedSource;

// The index value satisfies this subscription's declared result, so any key does.
const wideIndexedSource: ContractRootSubscriptionSource<
  TypedIndexedContracts,
  'either',
  'any-key'
> = 'any-key';
void wideIndexedSource;

// @ts-expect-error A `number | string` key cannot back a subscription declaring `number`.
const narrowIndexedSource: ContractRootSubscriptionSource<
  TypedIndexedContracts,
  'count',
  'any-key'
> = 'any-key';
void narrowIndexedSource;

// The named `count: number` is narrower than the index value and still reads as
// `number`, so it backs the `count` subscription even though sibling keys cannot.
const namedOverIndexSource: ContractRootSubscriptionSource<
  MixedIndexedContracts,
  'count',
  'count'
> = 'count';
void namedOverIndexSource;

// @ts-expect-error Any other key falls back to the wider index value.
const siblingOfNamedSource: ContractRootSubscriptionSource<
  MixedIndexedContracts,
  'count',
  'arbitrary'
> = 'arbitrary';
void siblingOfNamedSource;

// ---- union states -----------------------------------------------------
// A union state is only ever one of its variants at runtime, so a root
// subscription needs a key every variant declares with a satisfying type.
// `keyof` over a union keeps only the shared keys, which would read a disjoint
// state as declaring nothing at all; the check distributes instead.

interface DisjointStateContracts extends ReflexContracts {
  state: { count: number } | { label: string };
  subscriptions: { count: { params: []; result: number } };
}
interface SharedStateContracts extends ReflexContracts {
  state:
    { status: 'loading'; items: readonly string[] } | { status: 'ready'; items: readonly string[] };
  subscriptions: {
    items: { params: []; result: readonly string[] };
    status: { params: []; result: 'loading' | 'ready' };
  };
}

// @ts-expect-error `count` is absent from the second variant.
const disjointOwnKeySource: ContractRootSubscriptionSource<
  DisjointStateContracts,
  'count',
  'count'
> = 'count';
// @ts-expect-error `label` is absent from the first variant, and is not a number.
const disjointOtherKeySource: ContractRootSubscriptionSource<
  DisjointStateContracts,
  'count',
  'label'
> = 'label';
// @ts-expect-error A disjoint union state is declared, so unknown keys are still rejected.
const disjointAbsentSource: ContractRootSubscriptionSource<
  DisjointStateContracts,
  'count',
  'absent'
> = 'absent';
void disjointOwnKeySource;
void disjointOtherKeySource;
void disjointAbsentSource;

// Keys carried by every variant stay valid, including a discriminant whose
// per-variant literals both satisfy the declared result.
const sharedItemsSource: ContractRootSubscriptionSource<SharedStateContracts, 'items', 'items'> =
  'items';
const sharedStatusSource: ContractRootSubscriptionSource<SharedStateContracts, 'status', 'status'> =
  'status';
void sharedItemsSource;
void sharedStatusSource;

// ---- numeric state keys -----------------------------------------------
// `sourceKey` is always a string, but a state may declare a numeric key, and
// `state['0']` and `state[0]` are one property at runtime. Such a state is
// declared, not open, and the numeric-string form resolves onto its key.

interface NumericKeyContracts extends ReflexContracts {
  state: { 0: string };
  subscriptions: {
    first: { params: []; result: string };
    counted: { params: []; result: number };
  };
}
interface NumberIndexedStateContracts extends ReflexContracts {
  state: Record<number, string>;
  subscriptions: { first: { params: []; result: string } };
}

const numericSource: ContractRootSubscriptionSource<NumericKeyContracts, 'first', '0'> = '0';
const numberIndexedSource: ContractRootSubscriptionSource<
  NumberIndexedStateContracts,
  'first',
  '1'
> = '1';
void numericSource;
void numberIndexedSource;

// @ts-expect-error Key `0` holds a string, not the number `counted` declares.
const numericMistyped: ContractRootSubscriptionSource<NumericKeyContracts, 'counted', '0'> = '0';
// @ts-expect-error A numeric-key state is declared, so unknown keys are still rejected.
const numericAbsent: ContractRootSubscriptionSource<NumericKeyContracts, 'first', 'absent'> =
  'absent';
// @ts-expect-error `01` is a distinct string property, not the canonical form of key `1`.
const leadingZeroSource: ContractRootSubscriptionSource<
  NumberIndexedStateContracts,
  'first',
  '01'
> = '01';
// @ts-expect-error Exponent notation does not name the runtime property `1`.
const exponentSource: ContractRootSubscriptionSource<NumberIndexedStateContracts, 'first', '1e0'> =
  '1e0';
void numericMistyped;
void numericAbsent;
void leadingZeroSource;
void exponentSource;

// ---- subscription index signatures ------------------------------------
// The id set is open or closed on the same terms as the state's key set. An
// absent or permissive section declares unbounded params, but a typed index
// signature declares what every id it admits accepts.

interface ParameterizedIndexSubContracts extends ReflexContracts {
  state: { value: number };
  subscriptions: Record<string, { params: [factor: number]; result: number }>;
}
interface ParameterlessIndexSubContracts extends ReflexContracts {
  state: { value: number };
  subscriptions: Record<string, { params: []; result: number }>;
}
interface MixedSubContracts extends ReflexContracts {
  state: { value: number };
  subscriptions: {
    [id: string]: { params: readonly any[]; result: any };
    scaled: { params: [factor: number]; result: number };
  };
}
interface ArrayParamSubContracts extends ReflexContracts {
  state: { value: number };
  subscriptions: {
    empty: { params: []; result: number };
    many: { params: number[]; result: number };
    atLeastOne: { params: [first: number, ...rest: number[]]; result: number };
  };
}
interface UnionIndexSubContracts extends ReflexContracts {
  state: { value: number };
  subscriptions: {
    [id: string]: { params: []; result: number } | { params: [factor: number]; result: number };
    plain: { params: []; result: number };
  };
}

// Every id this index signature admits is parameterized, so none is eligible.
type ParameterizedIndexRootIds = ContractRootSubscriptionId<ParameterizedIndexSubContracts>;
// @ts-expect-error No id can back a root subscription under this contract.
const parameterizedIndexId: ParameterizedIndexRootIds = 'scaled';
void parameterizedIndexId;

// An index signature declaring no parameters keeps every id available.
const parameterlessIndexId: ContractRootSubscriptionId<ParameterlessIndexSubContracts> = 'anything';
void parameterlessIndexId;

// Typed arrays and variadic tuples can carry arguments and are not the
// permissive `any[]` fallback.
const emptyArrayParamId: ContractRootSubscriptionId<ArrayParamSubContracts> = 'empty';
// @ts-expect-error A typed array permits argument-bearing queries.
const typedArrayParamId: ContractRootSubscriptionId<ArrayParamSubContracts> = 'many';
// @ts-expect-error A variadic tuple requires at least one argument.
const variadicParamId: ContractRootSubscriptionId<ArrayParamSubContracts> = 'atLeastOne';
void emptyArrayParamId;
void typedArrayParamId;
void variadicParamId;

// A named entry under an open index signature is read through its own
// declaration, the same way a named state property is.
const openIndexSubject: ContractRootSubscriptionSubject<MixedSubContracts, 'other'> = 'other';
const unionIndexNamedSubject: ContractRootSubscriptionSubject<UnionIndexSubContracts, 'plain'> =
  'plain';
void openIndexSubject;
void unionIndexNamedSubject;

// @ts-expect-error `scaled` declares a parameter though the index signature is open.
const namedParameterizedSubject: ContractRootSubscriptionSubject<MixedSubContracts, 'scaled'> =
  'scaled';
// @ts-expect-error The union-valued index does not guarantee an arbitrary id is parameterless.
const unionIndexArbitrarySubject: ContractRootSubscriptionSubject<UnionIndexSubContracts, 'other'> =
  'other';
void namedParameterizedSubject;
void unionIndexArbitrarySubject;

// Undeclared and permissive sections stay open.
const permissiveSubject: ContractRootSubscriptionSubject<PermissiveReflexContracts, 'any/sub'> =
  'any/sub';
void permissiveSubject;

declare const permissive: ContractRuntime<PermissiveReflexContracts>;
permissive.dispatch(['any/event', 1, 'two']);
permissive.emit(['any-effect', { anything: true }]);
const permissiveResult: any = permissive.getSubscriptionValue(['any/sub', { page: 1 }]);
void permissiveResult;
