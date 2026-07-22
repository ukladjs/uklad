import reflex = require('@flexsurfer/reflex');
import reflexReact = require('@flexsurfer/reflex/react');
import reflexVanilla = require('@flexsurfer/reflex/vanilla');
import type {
  EventRegistrationOptions,
  ReflexInspector,
  ReflexInspectorSnapshot,
  Trace,
} from '@flexsurfer/reflex';

const options: EventRegistrationOptions = { coeffects: [['now']] };
const trace: Trace | undefined = undefined;
const runtime = reflexVanilla.createReflexRuntime({ initialState: { package: 'cjs' } });
runtime.regEvent('package/cjs', () => undefined);
runtime.dispatch(['package/cjs']);
const runtimeState: unknown = runtime.getState();
const inspector: ReflexInspector = runtime.createInspector();
const snapshot: ReflexInspectorSnapshot = inspector.getSnapshot();
const removeTraceListener = inspector.subscribeTraces(() => {});
const removeSubscriptionListener = runtime.watchSubscription(['package/cjs'], () => {});
const hooks = reflexReact.createReflexHooks();

void options;
void trace;
void snapshot;
void runtimeState;
void reflexReact.ReflexProvider;
void reflexReact.useReflexRuntime;
void hooks;
removeTraceListener();
removeSubscriptionListener();
