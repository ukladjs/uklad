import reflex = require('@flexsurfer/reflex');
import reflexReact = require('@flexsurfer/reflex/react');
import reflexVanilla = require('@flexsurfer/reflex/vanilla');
import type {
  EventRegistrationOptions,
  ReflexInspector,
  ReflexInspectorSnapshot,
  Trace,
} from '@flexsurfer/reflex';

reflex.dispatch(['package/cjs']);
reflex.regEvent('package/cjs', () => undefined);
const value: unknown = reflex.useSubscription(['package/cjs']);
const db = reflex.getAppDb();
const options: EventRegistrationOptions = { coeffects: [['now']] };
const trace: Trace | undefined = undefined;
const inspector: ReflexInspector = reflex.createReflexInspector();
const snapshot: ReflexInspectorSnapshot = inspector.getSnapshot();
const removeTraceListener = inspector.subscribeTraces(() => {});
const runtime = reflexVanilla.createReflexRuntime({ initialDb: { package: 'cjs' } });
const runtimeDb: unknown = runtime.getAppDb();
const removeSubscriptionListener = reflexVanilla.watchSubscription(['package/cjs'], () => {});
const hooks = reflexReact.createReflexHooks();

void value;
void db;
void options;
void trace;
void snapshot;
void reflexVanilla.defaultRuntime;
void runtimeDb;
void reflexReact.ReflexProvider;
void reflexReact.useReflexRuntime;
void hooks;
removeTraceListener();
removeSubscriptionListener();
