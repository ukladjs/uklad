import type {
  ReflexInspector as CoreReflexInspector,
  createReflexInspectorForRuntime,
} from '../../../reflex/src/inspector';
import type { ReflexInspector as DevtoolsReflexInspector } from '../../src/client/types';

type Assert<T extends true> = T;

export type InspectorApiVersionContract = Assert<
  CoreReflexInspector['apiVersion'] extends 2 ? true : false
>;

export type InspectorRuntimeIdContract = Assert<
  CoreReflexInspector['runtimeId'] extends string ? true : false
>;

export type InspectorRuntimeNameContract = Assert<
  CoreReflexInspector['runtimeName'] extends string ? true : false
>;

/** Core adapters must remain assignable to the independently published DevTools port. */
export type InspectorContract = Assert<
  CoreReflexInspector extends DevtoolsReflexInspector ? true : false
>;

/** The public factory return type must preserve the same assignability contract. */
export type InspectorFactoryContract = Assert<
  ReturnType<typeof createReflexInspectorForRuntime> extends DevtoolsReflexInspector ? true : false
>;
