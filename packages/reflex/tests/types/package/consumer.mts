import {
  createReflexInspector,
  dispatch,
  getAppDb,
  regEvent,
  useSubscription,
} from '@flexsurfer/reflex';
import {
  createReflexRuntime,
  defaultRuntime as vanillaDefaultRuntime,
  watchSubscription,
} from '@flexsurfer/reflex/vanilla';
import {
  ReflexProvider,
  createReflexHooks,
  useReflexRuntime,
  useSubscription as useReactSubscription,
} from '@flexsurfer/reflex/react';
import type {
  EventRegistrationOptions,
  ReflexInspector,
  ReflexInspectorSnapshot,
  Trace,
} from '@flexsurfer/reflex';

dispatch(['package/esm']);
regEvent('package/esm', () => undefined);
const value: unknown = useSubscription(['package/esm']);
const db = getAppDb();
const options: EventRegistrationOptions = { coeffects: [['now']] };
const trace: Trace | undefined = undefined;
const inspector: ReflexInspector = createReflexInspector();
const snapshot: ReflexInspectorSnapshot = inspector.getSnapshot();
const removeTraceListener = inspector.subscribeTraces(() => {});
const runtime = createReflexRuntime({ initialDb: { package: 'esm' } });
const runtimeDb: unknown = runtime.getAppDb();
const removeSubscriptionListener = watchSubscription(['package/esm'], () => {});
const hooks = createReflexHooks();

void value;
void db;
void options;
void trace;
void snapshot;
void vanillaDefaultRuntime;
void runtimeDb;
void ReflexProvider;
void useReflexRuntime;
void useReactSubscription;
void hooks;
removeTraceListener();
removeSubscriptionListener();
