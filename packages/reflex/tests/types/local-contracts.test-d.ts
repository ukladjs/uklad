import type {
  ContractDb,
  ContractDispatchVector,
  ContractEffectVector,
  ContractEventId,
  ContractEventParams,
  ContractSubscribeVector,
  ContractSubscriptionId,
  ContractSubscriptionParams,
  ContractSubscriptionResult,
  ContractSubscriptionVector,
  PermissiveReflexContracts,
  ReflexContracts,
} from '../../src/contracts';

interface CounterContracts extends ReflexContracts {
  db: { count: number };
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
  db: { value: string };
  events: {
    set: [value: string];
  };
  subscriptions: {
    value: { params: []; result: string };
  };
}

interface ContractRuntime<TContracts extends ReflexContracts> {
  getAppDb(): ContractDb<TContracts>;
  dispatch(event: ContractDispatchVector<TContracts>): void;
  emit(effect: ContractEffectVector<TContracts>): void;
  getSubscriptionValue<TId extends ContractSubscriptionId<TContracts>>(
    query: ContractSubscriptionVector<TContracts, TId>,
  ): ContractSubscriptionResult<TContracts, TId>;
}

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

const counterDb: { count: number } = counter.getAppDb();
const sessionDb: { value: string } = session.getAppDb();
void counterDb;
void sessionDb;

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

declare const permissive: ContractRuntime<PermissiveReflexContracts>;
permissive.dispatch(['any/event', 1, 'two']);
permissive.emit(['any-effect', { anything: true }]);
const permissiveResult: any = permissive.getSubscriptionValue(['any/sub', { page: 1 }]);
void permissiveResult;
