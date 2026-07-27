/**
 * Development-only runtime adapters.
 *
 * This entrypoint is intentionally separate from `./vanilla`: production
 * applications cannot access inspector capabilities unless they explicitly
 * import this adapter.
 */
import { createReflexInspector as createInspectorForCore } from './inspector';
import { getRuntimeCoreForDevtools } from './runtime/runtime';

import type { ReflexInspector } from './inspector-types';

/** Minimal owner identity required to request a development adapter. */
export interface ReflexDevtoolsRuntimeOwner {
  readonly runtimeInstanceId: string;
}

export function createReflexInspector(runtime: ReflexDevtoolsRuntimeOwner): ReflexInspector {
  return createInspectorForCore(getRuntimeCoreForDevtools(runtime));
}

export type {
  ReflexDevtoolsOperationRuntime,
  ReflexHandlerKeys,
  ReflexInspector,
  ReflexInspectorSnapshot,
} from './inspector-types';
