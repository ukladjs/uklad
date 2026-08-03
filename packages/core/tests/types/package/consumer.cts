import uklad = require('@ukladjs/core');
import ukladReact = require('@ukladjs/core/react');
import ukladVanilla = require('@ukladjs/core/vanilla');
import ukladDevtools = require('@ukladjs/core/devtools');
import ukladTesting = require('@ukladjs/core/testing');
import type {
  EventRegistrationOptions,
  UkladInspector,
  UkladInspectorSnapshot,
  Trace,
} from '@ukladjs/core';

const options: EventRegistrationOptions = { coeffects: { now: 'now' } };
const namedOptions: EventRegistrationOptions<{ package: string }> = {
  coeffects: { now: 'system/now' },
};
const trace: Trace | undefined = undefined;
const runtime = ukladVanilla.createUkladRuntime({ initialState: { package: 'cjs' } });
runtime.registerModule((registrar) => {
  registrar.regEvent('package/cjs', () => undefined);
  registrar.regEvent('package/cjs-named', ({ coeffects: { now } }) => void now, {
    coeffects: { now: 'system/now' },
  });
});
runtime.dispatch(['package/cjs']);
const inspector: UkladInspector = ukladDevtools.createUkladInspector(runtime);
const testHarness = ukladTesting.createUkladTestHarness(runtime);
const runtimeState: unknown = testHarness.getState();
const snapshot: UkladInspectorSnapshot = inspector.getSnapshot();
const removeTraceListener = inspector.subscribeTraces(() => {});
const removeSubscriptionListener = testHarness.watchSubscription(['package/cjs'], () => {});
const hooks = ukladReact.createUkladHooks();

void options;
void namedOptions;
void trace;
void snapshot;
void testHarness.getEventHandler('package/cjs');
void runtimeState;
void ukladReact.UkladProvider;
void ukladReact.useUkladRuntime;
void hooks;
removeTraceListener();
removeSubscriptionListener();
