import { createReflexRuntime } from '@flexsurfer/reflex/vanilla';
import { createReflexInspector } from '@flexsurfer/reflex/devtools';
import { createReflexTestHarness } from '@flexsurfer/reflex/testing';
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

const options: EventRegistrationOptions = { coeffects: { now: 'now' } };
const namedOptions: EventRegistrationOptions<{ package: string }> = {
  coeffects: { now: 'system/now' },
};
const trace: Trace | undefined = undefined;
const runtime = createReflexRuntime({ initialState: { package: 'esm' } });
runtime.registerModule((registrar) => {
  registrar.regEvent('package/esm', () => undefined);
  registrar.regEvent('package/esm-named', ({ coeffects: { now } }) => void now, {
    coeffects: { now: 'system/now' },
  });
});
runtime.dispatch(['package/esm']);
const inspector: ReflexInspector = createReflexInspector(runtime);
const testHarness = createReflexTestHarness(runtime);
const runtimeState: unknown = testHarness.getState();
const snapshot: ReflexInspectorSnapshot = inspector.getSnapshot();
const removeTraceListener = inspector.subscribeTraces(() => {});
const removeSubscriptionListener = testHarness.watchSubscription(['package/esm'], () => {});
const hooks = createReflexHooks();

void options;
void namedOptions;
void trace;
void snapshot;
void testHarness.getEventHandler('package/esm');
void runtimeState;
void ReflexProvider;
void useReflexRuntime;
void useReactSubscription;
void hooks;
removeTraceListener();
removeSubscriptionListener();
