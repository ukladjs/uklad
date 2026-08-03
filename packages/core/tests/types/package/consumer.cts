import reflex = require('@flexsurfer/reflex');
import reflexReact = require('@flexsurfer/reflex/react');
import reflexVanilla = require('@flexsurfer/reflex/vanilla');
import reflexDevtools = require('@flexsurfer/reflex/devtools');
import reflexTesting = require('@flexsurfer/reflex/testing');
import type {
  EventRegistrationOptions,
  ReflexInspector,
  ReflexInspectorSnapshot,
  Trace,
} from '@flexsurfer/reflex';

const options: EventRegistrationOptions = { coeffects: { now: 'now' } };
const namedOptions: EventRegistrationOptions<{ package: string }> = {
  coeffects: { now: 'system/now' },
};
const trace: Trace | undefined = undefined;
const runtime = reflexVanilla.createReflexRuntime({ initialState: { package: 'cjs' } });
runtime.registerModule((registrar) => {
  registrar.regEvent('package/cjs', () => undefined);
  registrar.regEvent('package/cjs-named', ({ coeffects: { now } }) => void now, {
    coeffects: { now: 'system/now' },
  });
});
runtime.dispatch(['package/cjs']);
const inspector: ReflexInspector = reflexDevtools.createReflexInspector(runtime);
const testHarness = reflexTesting.createReflexTestHarness(runtime);
const runtimeState: unknown = testHarness.getState();
const snapshot: ReflexInspectorSnapshot = inspector.getSnapshot();
const removeTraceListener = inspector.subscribeTraces(() => {});
const removeSubscriptionListener = testHarness.watchSubscription(['package/cjs'], () => {});
const hooks = reflexReact.createReflexHooks();

void options;
void namedOptions;
void trace;
void snapshot;
void testHarness.getEventHandler('package/cjs');
void runtimeState;
void reflexReact.ReflexProvider;
void reflexReact.useReflexRuntime;
void hooks;
removeTraceListener();
removeSubscriptionListener();
