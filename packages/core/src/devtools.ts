/**
 * Development-only runtime adapters.
 *
 * This entrypoint is intentionally separate from `./vanilla`: production
 * applications cannot access inspector capabilities unless they explicitly
 * import this adapter.
 */
import { createUkladInspector as createInspectorForCore } from './inspector';
import { getRuntimeCoreForDevtools } from './runtime/runtime';

import type { UkladInspector } from './inspector-types';

/** Minimal owner identity required to request a development adapter. */
export interface UkladDevtoolsRuntimeOwner {
  readonly runtimeInstanceId: string;
}

export function createUkladInspector(runtime: UkladDevtoolsRuntimeOwner): UkladInspector {
  return createInspectorForCore(getRuntimeCoreForDevtools(runtime));
}

export type {
  UkladDevtoolsOperationRuntime,
  UkladHandlerKeys,
  UkladInspector,
  UkladInspectorSnapshot,
  UkladStateRevisionsCallback,
} from './inspector-types';
