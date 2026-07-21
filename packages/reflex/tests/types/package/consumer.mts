import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';
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

const options: EventRegistrationOptions = { coeffects: [['now']] };
const trace: Trace | undefined = undefined;
const runtime = createReflexRuntime({ initialDb: { package: 'esm' } });
runtime.regEvent('package/esm', () => undefined);
runtime.dispatch(['package/esm']);
const runtimeDb: unknown = runtime.getAppDb();
const inspector: ReflexInspector = runtime.createInspector();
const snapshot: ReflexInspectorSnapshot = inspector.getSnapshot();
const removeTraceListener = inspector.subscribeTraces(() => {});
const removeSubscriptionListener = runtime.watchSubscription(['package/esm'], () => {});
const hooks = createReflexHooks();

void options;
void trace;
void snapshot;
void runtimeDb;
void ReflexProvider;
void useReflexRuntime;
void useReactSubscription;
void hooks;
removeTraceListener();
removeSubscriptionListener();
