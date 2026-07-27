/** Structural operation port supplied by a runtime-bound Reflex inspector. */
export type OperationEventVector = [string, ...any[]];

export interface DevtoolsExecutionObserver {
  accept(
    event: OperationEventVector,
    parent?: {
      readonly operation: { readonly operationId: string; readonly value: unknown };
      readonly sourceEffectId?: string;
      readonly sourceEffectIndex?: number;
    },
  ): { readonly operationId: string; readonly value: unknown };
  queued(
    operation: { readonly operationId: string; readonly value: unknown },
    revision: number,
  ): void;
  started(
    operation: { readonly operationId: string; readonly value: unknown },
    revision: number,
  ): void;
  transition(
    operation: { readonly operationId: string; readonly value: unknown },
    status: string,
    error?: unknown,
  ): void;
  committed(
    operation: { readonly operationId: string; readonly value: unknown },
    status: string,
    revision: number,
  ): void;
  effect?(
    operation: { readonly operationId: string; readonly value: unknown },
    effect: DevtoolsEffectFact,
  ): void;
  finished(
    operation: { readonly operationId: string; readonly value: unknown },
    status: string,
    error?: unknown,
  ): void;
  dropped(
    operations: readonly { readonly operationId: string; readonly value: unknown }[],
    error: unknown,
  ): void;
  published(revision: number): void;
  disposed(error: unknown): void;
}

/** Runtime-neutral effect fact supplied through the optional execution probe. */
export interface DevtoolsEffectFact {
  readonly type: string;
  readonly value: unknown;
  readonly index: number;
  readonly status: 'succeeded' | 'returned' | 'failed' | 'unhandled' | 'invalid' | 'detached';
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly error?: unknown;
}

export interface DevtoolsOperationRuntime {
  readonly runtimeId: string;
  readonly runtimeInstanceId: string;
  dispatch(event: never): string;
  flush(): Promise<void>;
  observeExecution(observer: DevtoolsExecutionObserver): () => void;
}
