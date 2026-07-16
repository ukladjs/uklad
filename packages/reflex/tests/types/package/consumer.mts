import {
  createReflexInspector,
  dispatch,
  getAppDb,
  regEvent,
  useSubscription,
} from '@flexsurfer/reflex';
import type {
  EventRegistrationOptions,
  ReflexInspector,
  ReflexInspectorSnapshot,
  Trace,
} from '@flexsurfer/reflex';

dispatch(['package/esm']);
regEvent('package/esm', () => undefined);
const value: unknown = useSubscription(['package/esm']);
const db = getAppDb();
const options: EventRegistrationOptions = { coeffects: [['now']] };
const trace: Trace | undefined = undefined;
const inspector: ReflexInspector = createReflexInspector();
const snapshot: ReflexInspectorSnapshot = inspector.getSnapshot();
const removeTraceListener = inspector.subscribeTraces(() => {});

void value;
void db;
void options;
void trace;
void snapshot;
removeTraceListener();
