import type {
  ReflexInspector as CoreReflexInspector,
  createReflexInspector,
} from '../../../reflex/src/inspector';
import type { ReflexInspector as DevtoolsReflexInspector } from '../../src/client/types';

type Assert<T extends true> = T;

/** Core adapters must remain assignable to the independently published DevTools port. */
export type InspectorContract = Assert<
  CoreReflexInspector extends DevtoolsReflexInspector ? true : false
>;

/** The public factory return type must preserve the same assignability contract. */
export type InspectorFactoryContract = Assert<
  ReturnType<typeof createReflexInspector> extends DevtoolsReflexInspector ? true : false
>;
