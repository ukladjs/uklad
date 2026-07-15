// CommonJS consumer typechecked with legacy TypeScript versions (see ../run.js).
// Keep the syntax conservative: this file must compile under TypeScript 4.9.
import reflex = require('@flexsurfer/reflex');
import type { EventRegistrationOptions, Trace } from '@flexsurfer/reflex';

reflex.dispatch(['legacy/cjs']);
reflex.regEvent('legacy/cjs', () => undefined);
const value: unknown = reflex.useSubscription(['legacy/cjs']);
const db = reflex.getAppDb();
const options: EventRegistrationOptions = { coeffects: [['now']] };
const trace: Trace | undefined = undefined;

void value;
void db;
void options;
void trace;
