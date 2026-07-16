import { dispatch, getAppDb, regEvent, useSubscription } from '@flexsurfer/reflex';
import type { EventRegistrationOptions, Trace } from '@flexsurfer/reflex';

dispatch(['package/esm']);
regEvent('package/esm', () => undefined);
const value: unknown = useSubscription(['package/esm']);
const db = getAppDb();
const options: EventRegistrationOptions = { coeffects: [['now']] };
const trace: Trace | undefined = undefined;

void value;
void db;
void options;
void trace;
