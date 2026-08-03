import type { RuntimeTrackingContext } from '../runtime/probe-types';
import type { EventVector } from '../types';

/** The executor's minimal work item. Tracking exists only with an attached probe. */
export interface ExecutionEnvelope {
  readonly event: EventVector;
  readonly tracking?: RuntimeTrackingContext;
}
