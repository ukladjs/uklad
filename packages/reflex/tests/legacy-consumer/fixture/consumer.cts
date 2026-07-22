// CommonJS consumer typechecked with legacy TypeScript versions (see ../run.js).
// Keep the syntax conservative: this file must compile under TypeScript 4.9.
import reflex = require('@flexsurfer/reflex');
import reflexReact = require('@flexsurfer/reflex/react');
import reflexVanilla = require('@flexsurfer/reflex/vanilla');
import type { EventRegistrationOptions, Trace } from '@flexsurfer/reflex';

const runtime = reflexVanilla.createReflexRuntime({ initialState: {} });
runtime.dispatch(['legacy/cjs']);
runtime.regEvent('legacy/cjs', () => undefined);
const value: unknown = reflex.useSubscription(['legacy/cjs']);
const state = runtime.getState();
const options: EventRegistrationOptions = { coeffects: [['now']] };
const trace: Trace | undefined = undefined;

void value;
void state;
void options;
void trace;
void reflexReact.ReflexProvider;
void runtime;
