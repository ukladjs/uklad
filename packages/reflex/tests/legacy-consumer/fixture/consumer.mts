// ESM consumer typechecked with legacy TypeScript versions (see ../run.js).
// Keep the syntax conservative: this file must compile under TypeScript 4.9.
import { createReflexRuntime, useSubscription } from '@flexsurfer/reflex';
import { ReflexProvider } from '@flexsurfer/reflex/react';
import type { ErrorHandler, EventRegistrationOptions, Interceptor } from '@flexsurfer/reflex';

const runtime = createReflexRuntime({ initialDb: {} });
runtime.dispatch(['legacy/esm']);
runtime.regEvent('legacy/esm', () => undefined);
runtime.regSub('legacy/root');
runtime.regSub(
  'legacy/doubled',
  (count: number) => count * 2,
  () => [['legacy/root']],
);

const value: unknown = useSubscription(['legacy/esm']);
const db = runtime.getAppDb();
const options: EventRegistrationOptions = { coeffects: [['now']] };
const interceptor: Interceptor = { id: 'legacy/noop', before: (context) => context };
const errorHandler: ErrorHandler = (originalError, reflexError) => {
  void originalError.message;
  void reflexError.data.interceptor;
};
void value;
void db;
void options;
void interceptor;
void errorHandler;
void ReflexProvider;
void runtime;
