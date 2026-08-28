import type { EqualityCheckFn, SubVector } from '../../types';
import type { ExternalSubscriptionDriver } from './external/types';

export type { ExternalSubscriptionContext, ExternalSubscriptionDriver } from './external/types';

declare const subscriptionNodeType: unique symbol;

/** Opaque runtime-owned handle. Runtime operations are the entire contract. */
export interface SubscriptionNode<T> {
  readonly [subscriptionNodeType]: T;
}

export type SubscriptionKind = 'root' | 'computed' | 'external';

export interface SubscriptionSpec<T> {
  key: string;
  query: SubVector;
  kind: SubscriptionKind;
  /** Receives one array holding every dependency value in declaration order. */
  compute: (dependencyValues: any[]) => T;
  dependencies: SubscriptionNode<any>[];
  equalityCheck: EqualityCheckFn;
  /** Present only for the external node kind; absent for ordinary nodes. */
  external?: ExternalSubscriptionDriver<readonly unknown[], T>;
  onActive: () => void;
  onUnused: () => void;
}

/** Read-only cached state for devtools; never exposes the runtime node. */
export interface SubscriptionDiagnostic {
  readonly key: string;
  readonly query: Readonly<SubVector>;
  readonly kind: SubscriptionKind;
  readonly active: boolean;
  readonly version: number;
  readonly status: 'empty' | 'value' | 'error';
  readonly value?: unknown;
  readonly error?: string;
}

/** @internal Trace classification for a subscription listener. */
export type SubscriptionListenerKind = 'render' | 'watch';

/** @internal Immutable listener metadata captured during publication. */
export type SubscriptionListenerRegistration = readonly [
  listener: () => void,
  label: string,
  kind: SubscriptionListenerKind,
];
