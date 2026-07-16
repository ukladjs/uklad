import reflex = require('@flexsurfer/reflex');
import type {
  EventRegistrationOptions,
  ReflexInspector,
  ReflexInspectorSnapshot,
  Trace,
} from '@flexsurfer/reflex';

reflex.dispatch(['package/cjs']);
reflex.regEvent('package/cjs', () => undefined);
const value: unknown = reflex.useSubscription(['package/cjs']);
const db = reflex.getAppDb();
const options: EventRegistrationOptions = { coeffects: [['now']] };
const trace: Trace | undefined = undefined;
const inspector: ReflexInspector = reflex.createReflexInspector();
const snapshot: ReflexInspectorSnapshot = inspector.getSnapshot();
const removeTraceListener = inspector.subscribeTraces(() => {});

void value;
void db;
void options;
void trace;
void snapshot;
removeTraceListener();
