// ESM consumer typechecked with legacy TypeScript versions (see ../run.js).
// Keep the syntax conservative: this file must compile under TypeScript 4.9.
import { dispatch, getAppDb, regEvent, regSub, useSubscription } from '@flexsurfer/reflex';
import type { ErrorHandler, EventRegistrationOptions, Interceptor } from '@flexsurfer/reflex';

dispatch(['legacy/esm']);
regEvent('legacy/esm', () => undefined);
regSub('legacy/root');
regSub<number>(
  'legacy/doubled',
  (count: number) => count * 2,
  () => [['legacy/root']],
);

const value: unknown = useSubscription(['legacy/esm']);
const db = getAppDb();
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
