import type { DevelopmentOperationReference } from './execution-observer';
import type { EventVector } from '../types';

/** The executor's minimal work item. Operation metadata exists only with DevTools attached. */
export interface ExecutionEnvelope {
  readonly event: EventVector;
  readonly operation?: DevelopmentOperationReference;
}
