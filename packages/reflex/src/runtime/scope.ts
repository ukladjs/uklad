const RUNTIME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

let nextRuntimeId = 0;
const disposedRuntimeScopes = new WeakSet<RuntimeScope>();

/** @internal Immutable identity used as the key for instance-owned state. */
export interface RuntimeScope {
  readonly runtimeId: string;
  readonly runtimeName: string;
}

export interface RuntimeIdentityOptions {
  readonly runtimeId?: string;
  readonly name?: string;
}

export const defaultRuntimeScope: RuntimeScope = Object.freeze({
  runtimeId: 'default',
  runtimeName: 'Default runtime',
});

/** @internal Create a process-local runtime identity. */
export function createRuntimeScope(options: RuntimeIdentityOptions = {}): RuntimeScope {
  const runtimeId = options.runtimeId ?? createGeneratedRuntimeId();
  if (typeof runtimeId !== 'string' || !RUNTIME_ID_PATTERN.test(runtimeId)) {
    throw new Error(
      '[reflex] runtimeId must be 1-128 characters and contain only letters, numbers, dot, underscore, colon, or hyphen.',
    );
  }

  const runtimeName = options.name ?? runtimeId;
  if (typeof runtimeName !== 'string' || runtimeName.length === 0 || runtimeName.length > 128) {
    throw new Error('[reflex] runtime name must be between 1 and 128 characters.');
  }

  return Object.freeze({ runtimeId, runtimeName });
}

function createGeneratedRuntimeId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return `runtime-${randomUUID.call(globalThis.crypto)}`;
  nextRuntimeId++;
  return `runtime-${Date.now().toString(36)}-${nextRuntimeId.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/** @internal Mark a runtime terminally disposed. */
export function markRuntimeDisposed(runtime: RuntimeScope): void {
  if (runtime === defaultRuntimeScope) {
    throw new Error('[reflex] The compatibility default runtime cannot be disposed.');
  }
  disposedRuntimeScopes.add(runtime);
}

/** @internal Return whether a runtime has entered its terminal state. */
export function isRuntimeDisposed(runtime: RuntimeScope): boolean {
  return disposedRuntimeScopes.has(runtime);
}
