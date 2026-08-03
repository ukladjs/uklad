// ESM consumer typechecked with legacy TypeScript versions (see ../run.js).
// Keep the syntax conservative: this file must compile under TypeScript 4.9.
import { createUkladRuntime, useSubscription } from '@ukladjs/core';
import { createUkladTestHarness } from '@ukladjs/core/testing';
import { UkladProvider } from '@ukladjs/core/react';
import type { ErrorHandler, EventRegistrationOptions, Interceptor } from '@ukladjs/core';

const runtime = createUkladRuntime({ initialState: {} });
const testHarness = createUkladTestHarness(runtime);
runtime.dispatch(['legacy/esm']);
runtime.registerModule((registrar) => {
  registrar.regEvent('legacy/esm', () => undefined);
});
runtime.registerModule((registrar) => {
  registrar.regRootSub('legacy/root', 'legacy/root');
});
runtime.registerModule((registrar) => {
  registrar.regSub(
    'legacy/doubled',
    () => [['legacy/root']],
    ([count]: [number]) => count * 2,
  );
});

const value: unknown = useSubscription(['legacy/esm']);
const state = testHarness.getState();
const options: EventRegistrationOptions = { coeffects: { now: 'now' } };
const interceptor: Interceptor = { id: 'legacy/noop', before: (context) => context };
const errorHandler: ErrorHandler = (originalError, ukladError) => {
  void originalError.message;
  void ukladError.data.interceptor;
};
void value;
void state;
void options;
void interceptor;
void errorHandler;
void UkladProvider;
void runtime;
