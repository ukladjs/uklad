// CommonJS consumer typechecked with legacy TypeScript versions (see ../run.js).
// Keep the syntax conservative: this file must compile under TypeScript 4.9.
import reflex = require('@flexsurfer/reflex');
import reflexReact = require('@flexsurfer/reflex/react');
import reflexVanilla = require('@flexsurfer/reflex/vanilla');
import type { EventRegistrationOptions, Trace } from '@flexsurfer/reflex';

reflex.dispatch(['legacy/cjs']);
reflex.regEvent('legacy/cjs', () => undefined);
const value: unknown = reflex.useSubscription(['legacy/cjs']);
const db = reflex.getAppDb();
const options: EventRegistrationOptions = { coeffects: [['now']] };
const trace: Trace | undefined = undefined;
const runtime = reflexVanilla.createReflexRuntime({ initialDb: {} });

void value;
void db;
void options;
void trace;
void reflexReact.ReflexProvider;
void reflexVanilla.defaultRuntime;
void runtime;
