// ESM consumer typechecked with legacy TypeScript versions (see ../run.js).
// Keep the syntax conservative: this file must compile under TypeScript 4.9.
import { createReflexRuntime, useSubscription } from '@flexsurfer/reflex';
import { createReflexTestHarness } from '@flexsurfer/reflex/testing';
import { ReflexProvider } from '@flexsurfer/reflex/react';
import type { ErrorHandler, EventRegistrationOptions, Interceptor } from '@flexsurfer/reflex';

const runtime = createReflexRuntime({ initialState: {} });
const testHarness = createReflexTestHarness(runtime);
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
const errorHandler: ErrorHandler = (originalError, reflexError) => {
  void originalError.message;
  void reflexError.data.interceptor;
};
void value;
void state;
void options;
void interceptor;
void errorHandler;
void ReflexProvider;
void runtime;
