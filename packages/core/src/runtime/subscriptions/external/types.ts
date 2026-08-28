import type { Id, SubVector } from '../../../types';

/** Runtime-private capability supplied to an external source while it is live. */
export interface ExternalSubscriptionContext {
  readonly invalidate: () => void;
}

/** One external source instance owned by one canonical subscription vector. */
export interface ExternalSubscriptionDriver<
  TInputs extends readonly unknown[] = readonly unknown[],
  TResult = unknown,
> {
  /** Read the current source snapshot synchronously without activating it. */
  readonly read: (inputs: TInputs) => TResult;
  /** Start observation for the first committed consumer. */
  readonly activate: (inputs: TInputs, context: ExternalSubscriptionContext) => void;
  /** Apply new dependency inputs after a live source is reconciled. */
  readonly sync: (inputs: TInputs) => void;
  /** Release every resource owned by this source instance. */
  readonly dispose: () => void;
}

/** @internal Runtime-owned definition for one registered external subscription id. */
export interface ExternalSubscriptionDefinition {
  readonly id: Id;
  readonly dependencies: (...params: any[]) => SubVector[];
  readonly createDriver: (...params: any[]) => ExternalSubscriptionDriver<readonly unknown[], any>;
  readonly token: symbol;
}
