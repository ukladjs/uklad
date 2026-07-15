import reflex = require('@flexsurfer/reflex');
import type { EventRegistrationOptions, Trace } from '@flexsurfer/reflex';

reflex.dispatch(['package/cjs']);
reflex.regEvent('package/cjs', () => undefined);
const value: unknown = reflex.useSubscription(['package/cjs']);
const db = reflex.getAppDb();
const options: EventRegistrationOptions = { coeffects: [['now']] };
const trace: Trace | undefined = undefined;

void value;
void db;
void options;
void trace;
