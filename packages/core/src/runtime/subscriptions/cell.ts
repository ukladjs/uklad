import { consoleLog } from '../../core/logging';
import { mergeRuntimeProbeSpan, withRuntimeProbeSpan } from '../probe';
import { ExternalSubscriptionController } from './external/controller';

import type { SubscriptionEngine } from './engine';
import type { SubscriptionListenerRegistration, SubscriptionSpec } from './types';

/** Root cells have no dependencies, so they always receive this empty list. */
const NO_DEPENDENCY_VALUES: any[] = [];

/** Cached value and lifecycle state for one node in a subscription graph. */
export class SubscriptionCell<T> {
  readonly engine: SubscriptionEngine;
  readonly spec: SubscriptionSpec<T>;
  readonly dependencies: SubscriptionCell<any>[];
  readonly uniqueDependencies: SubscriptionCell<any>[];
  readonly dependents: Set<SubscriptionCell<any>> = new Set<SubscriptionCell<any>>();
  readonly listeners: SubscriptionListenerRegistration[] = [];
  /** Fixed topological rank: roots are zero, dependents exceed every dependency. */
  readonly rank: number;

  // Cached result and error state. `initialized` distinguishes an unread cell
  // from a legitimate `undefined` result.
  value: T | undefined;
  initialized: boolean = false;
  hasValue: boolean = false;
  hasError: boolean = false;
  error: unknown;

  // Version stamps let computed cells skip equality work when no dependency
  // produced a new observable value.
  outputStamp: number = 0;
  dependencyStamps: number[] = [];

  // Active cells participate in push publication. A released computed cell is
  // terminal and must be reacquired through the canonical cache.
  active: boolean = false;
  disposed: boolean = false;

  /** External-only state is isolated from the ordinary subscription cell. */
  private readonly externalController: ExternalSubscriptionController<T> | undefined;

  // Per-operation marks avoid allocation-heavy visited sets during pull/push.
  lastPullEpoch: number = 0;
  queuedWave: number = 0;
  validatedEpoch: number = 0;

  constructor(engine: SubscriptionEngine, spec: SubscriptionSpec<T>) {
    this.engine = engine;
    this.spec = spec;
    this.dependencies = spec.dependencies.map((node) => engine.unwrap(node));
    this.uniqueDependencies = Array.from(new Set(this.dependencies));
    this.externalController = spec.external
      ? new ExternalSubscriptionController(spec.external)
      : undefined;
    this.rank =
      spec.kind === 'root' || (spec.kind === 'external' && this.dependencies.length === 0)
        ? 0
        : 1 + this.dependencies.reduce((rank, dependency) => Math.max(rank, dependency.rank), 0);
  }

  get current(): T {
    if (this.hasError) throw this.error;
    return this.value as T;
  }

  refreshRoot(): boolean {
    return this.runComputation(() => this.spec.compute(NO_DEPENDENCY_VALUES));
  }

  refreshComputed(force: boolean = false): boolean {
    const externalController = this.externalController;
    const dependencyCountChanged = this.dependencies.length !== this.dependencyStamps.length;
    let stale = force || !this.initialized || dependencyCountChanged;
    let externalInputsChanged = false;
    let failedDependency: SubscriptionCell<any> | undefined;
    for (let index = 0; index < this.dependencies.length; index++) {
      const dependency = this.dependencies[index]!;
      if (dependency.outputStamp !== this.dependencyStamps[index]) {
        stale = true;
        if (externalController !== undefined) externalInputsChanged = true;
      }
      if (!failedDependency && dependency.hasError) failedDependency = dependency;
    }

    let dependencyValues: any[] | undefined;
    if (externalController !== undefined) {
      dependencyValues = this.dependencies.map((dependency) => dependency.value);
      externalController.updateInputs(
        dependencyValues,
        this.initialized && (dependencyCountChanged || externalInputsChanged),
        failedDependency === undefined,
      );
    }
    // External nodes keep propagating a retained dependency error even when
    // its output stamp did not move between refresh attempts.
    if (!stale && (externalController === undefined || failedDependency === undefined))
      return false;

    this.dependencyStamps.length = this.dependencies.length;
    for (let index = 0; index < this.dependencies.length; index++) {
      this.dependencyStamps[index] = this.dependencies[index]!.outputStamp;
    }
    if (failedDependency) return this.setError(failedDependency.error);

    return this.runComputation(() => {
      if (externalController !== undefined) return externalController.read();
      return this.spec.compute(
        dependencyValues ?? this.dependencies.map((dependency) => dependency.value),
      );
    });
  }

  /** Whether this active source still owes its driver a dependency reconciliation. */
  needsExternalSync(): boolean {
    return this.externalController?.needsSync === true;
  }

  syncExternal(): void {
    this.externalController?.sync();
  }

  retainExternalError(error: unknown): boolean {
    return this.setError(error);
  }

  /** Start the external source after the node has acquired its first consumer. */
  activateExternal(invalidate: () => void): void {
    this.externalController?.activate(invalidate);
  }

  /** Dispose an external source exactly once, including a dormant provisional node. */
  disposeExternal(): void {
    this.externalController?.dispose();
  }

  publishTo(listeners: readonly SubscriptionListenerRegistration[]): void {
    for (const [listener, label, kind] of listeners) {
      try {
        withRuntimeProbeSpan(
          this.engine.runtime,
          () => ({
            opType: kind,
            operation: label,
            tags: { subscriptionKey: this.spec.key },
          }),
          listener,
        );
      } catch (error) {
        consoleLog('error', '[uklad] Error in subscription listener:', error);
      }
    }
  }

  traceDispose(): void {
    withRuntimeProbeSpan(
      this.engine.runtime,
      () => ({
        operation: this.spec.query[0],
        opType: 'sub/dispose',
        tags: { queryV: this.spec.query, subscriptionKey: this.spec.key },
      }),
      () => {},
    );
  }

  private runComputation(compute: () => T): boolean {
    let observableChanged = false;
    try {
      withRuntimeProbeSpan(
        this.engine.runtime,
        () => ({
          operation: this.spec.query[0],
          opType: 'sub/run',
          tags: {
            queryV: this.spec.query,
            subscriptionKey: this.spec.key,
            deps: this.dependencies.map((dependency) => dependency.spec.key),
          },
        }),
        () => {
          const nextValue = compute();
          const valueChanged =
            !this.hasValue ||
            (this.spec.kind === 'root'
              ? !Object.is(nextValue, this.value)
              : !this.spec.equalityCheck(nextValue, this.value));
          const recovered = this.hasError;

          if (valueChanged) this.value = nextValue;
          this.initialized = true;
          this.hasValue = true;
          this.hasError = false;
          this.error = undefined;
          observableChanged = valueChanged || recovered;
          if (observableChanged) this.outputStamp = this.engine.nextOutputStamp();

          mergeRuntimeProbeSpan(this.engine.runtime, () => ({
            'cached?': !observableChanged,
            version: this.outputStamp,
          }));
        },
      );
    } catch (error) {
      observableChanged = this.setError(error);
      if (observableChanged) {
        consoleLog('error', `[uklad] Error in subscription computation ${this.spec.key}:`, error);
      }
    }
    return observableChanged;
  }

  private setError(error: unknown): boolean {
    const observableChanged = !this.hasError || !Object.is(error, this.error);
    this.initialized = true;
    this.hasError = true;
    this.error = error;
    if (observableChanged) this.outputStamp = this.engine.nextOutputStamp();
    return observableChanged;
  }
}
