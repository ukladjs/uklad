import type {
  UkladInspector as CoreUkladInspector,
  createUkladInspector,
} from '../../../core/src/inspector';
import type { UkladInspector as DevtoolsUkladInspector } from '../../src/client/types';

type Assert<T extends true> = T;

export type InspectorApiVersionContract = Assert<
  CoreUkladInspector['apiVersion'] extends 2 ? true : false
>;

export type InspectorRuntimeIdContract = Assert<
  CoreUkladInspector['runtimeId'] extends string ? true : false
>;

export type InspectorRuntimeNameContract = Assert<
  CoreUkladInspector['runtimeName'] extends string ? true : false
>;

/** Core adapters must remain assignable to the independently published DevTools port. */
export type InspectorContract = Assert<
  CoreUkladInspector extends DevtoolsUkladInspector ? true : false
>;

/** The public factory return type must preserve the same assignability contract. */
export type InspectorFactoryContract = Assert<
  ReturnType<typeof createUkladInspector> extends DevtoolsUkladInspector ? true : false
>;
