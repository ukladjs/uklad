import type { EqualityCheckFn, SubVector } from '../../types';

declare const subscriptionNodeType: unique symbol;

/** Opaque runtime-owned handle. Runtime operations are the entire contract. */
export interface SubscriptionNode<T> {
  readonly [subscriptionNodeType]: T;
}

export type SubscriptionKind = 'root' | 'computed';

export interface SubscriptionSpec<T> {
  key: string;
  query: SubVector;
  kind: SubscriptionKind;
  compute: (...dependencyValues: any[]) => T;
  dependencies: SubscriptionNode<any>[];
  equalityCheck: EqualityCheckFn;
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
