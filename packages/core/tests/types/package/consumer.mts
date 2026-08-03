import { createUkladRuntime } from '@ukladjs/core/vanilla';
import { createUkladInspector } from '@ukladjs/core/devtools';
import { createUkladTestHarness } from '@ukladjs/core/testing';
import {
  UkladProvider,
  createUkladHooks,
  useUkladRuntime,
  useSubscription as useReactSubscription,
} from '@ukladjs/core/react';
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
const runtime = createUkladRuntime({ initialState: { package: 'esm' } });
runtime.registerModule((registrar) => {
  registrar.regEvent('package/esm', () => undefined);
  registrar.regEvent('package/esm-named', ({ coeffects: { now } }) => void now, {
    coeffects: { now: 'system/now' },
  });
});
runtime.dispatch(['package/esm']);
const inspector: UkladInspector = createUkladInspector(runtime);
const testHarness = createUkladTestHarness(runtime);
const runtimeState: unknown = testHarness.getState();
const snapshot: UkladInspectorSnapshot = inspector.getSnapshot();
const removeTraceListener = inspector.subscribeTraces(() => {});
const removeSubscriptionListener = testHarness.watchSubscription(['package/esm'], () => {});
const hooks = createUkladHooks();

void options;
void namedOptions;
void trace;
void snapshot;
void testHarness.getEventHandler('package/esm');
void runtimeState;
void UkladProvider;
void useUkladRuntime;
void useReactSubscription;
void hooks;
removeTraceListener();
removeSubscriptionListener();
