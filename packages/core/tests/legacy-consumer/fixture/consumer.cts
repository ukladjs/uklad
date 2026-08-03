// CommonJS consumer typechecked with legacy TypeScript versions (see ../run.js).
// Keep the syntax conservative: this file must compile under TypeScript 4.9.
import uklad = require('@ukladjs/core');
import ukladReact = require('@ukladjs/core/react');
import ukladVanilla = require('@ukladjs/core/vanilla');
import ukladTesting = require('@ukladjs/core/testing');
import type { EventRegistrationOptions, Trace } from '@ukladjs/core';

const runtime = ukladVanilla.createUkladRuntime({ initialState: {} });
const testHarness = ukladTesting.createUkladTestHarness(runtime);
runtime.dispatch(['legacy/cjs']);
runtime.registerModule((registrar) => {
  registrar.regEvent('legacy/cjs', () => undefined);
});
const value: unknown = uklad.useSubscription(['legacy/cjs']);
const state = testHarness.getState();
const options: EventRegistrationOptions = { coeffects: { now: 'now' } };
const trace: Trace | undefined = undefined;

void value;
void state;
void options;
void trace;
void ukladReact.UkladProvider;
void runtime;
