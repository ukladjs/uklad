import type { UkladContracts } from '@ukladjs/core/vanilla';

import type {
  CollectionUser,
  CollectionsNested,
  CollectionsPermissions,
  CollectionsRoles,
  CollectionsUserPermissions,
  CollectionsUsers,
} from '../../features/collections/state';
import type { CounterEffectDispatches, CounterValue } from '../../features/counter/state';
import type {
  DiagnosticsComplex,
  DiagnosticsImmerProbe,
  DiagnosticsNested,
  DiagnosticsPayload,
} from '../../features/diagnostics/state';
import type { User, UsersList, UsersLoading } from '../../features/users/state';
import type { appIds, stateKeys } from './catalog';

/**
 * The application state shape: one object whose top-level keys are the
 * reactive roots declared in `stateKeys`.
 *
 * There is no index signature. Every root a handler may write is declared
 * here, including the deliberately awkward `diagnostics*` ones, so the catalog
 * and this contract together are the whole truth about this app's state.
 */
export interface AppState {
  [stateKeys.counterValue]: CounterValue;
  [stateKeys.counterEffectDispatches]: CounterEffectDispatches;

  [stateKeys.usersList]: UsersList;
  [stateKeys.usersLoading]: UsersLoading;

  [stateKeys.collectionsUsers]: CollectionsUsers;
  [stateKeys.collectionsPermissions]: CollectionsPermissions;
  [stateKeys.collectionsRoles]: CollectionsRoles;
  [stateKeys.collectionsUserPermissions]: CollectionsUserPermissions;

  [stateKeys.diagnosticsNested]: DiagnosticsNested | null;
  [stateKeys.diagnosticsPayload]: DiagnosticsPayload;
  [stateKeys.diagnosticsImmerProbe]: DiagnosticsImmerProbe;
  [stateKeys.diagnosticsComplex]: DiagnosticsComplex;
}

/** Declared separately so `AppEventVector` can be derived without a cycle. */
export interface AppEvents {
  [appIds.events.counterIncrement]: [];
  [appIds.events.counterPersist]: [];
  [appIds.events.counterLoad]: [];
  [appIds.events.counterEffectDispatched]: [];

  [appIds.events.usersToggle]: [userId: number];
  [appIds.events.usersAdd]: [user: User];
  [appIds.events.usersSetLoading]: [isLoading: boolean];

  [appIds.events.collectionsAddUser]: [userId: string, user: CollectionUser];
  [appIds.events.collectionsRemoveUser]: [userId: string];
  [appIds.events.collectionsUpdateUser]: [userId: string, updates: Partial<CollectionUser>];
  [appIds.events.collectionsAddPermission]: [permission: string];
  [appIds.events.collectionsRemovePermission]: [permission: string];
  [appIds.events.collectionsAssignRole]: [userId: string, role: string];

  [appIds.events.diagnosticsDispatchFromEffect]: [];
  [appIds.events.diagnosticsSimulateError]: [];
  [appIds.events.diagnosticsEmitSink]: [];
  [appIds.events.diagnosticsBadParams]: [payload: unknown];
  [appIds.events.diagnosticsImmerProxy]: [];
  [appIds.events.diagnosticsWriteNested]: [];
  [appIds.events.diagnosticsCreateComplex]: [];
}

/** Every declared event as a dispatchable vector. */
export type AppEventVector = {
  [TId in keyof AppEvents]: [id: TId, ...params: AppEvents[TId]];
}[keyof AppEvents];

/**
 * The complete type contract for this application's runtime.
 *
 * It describes the whole application rather than one feature: every feature
 * module is typed against `UkladRegistrar<AppContracts>`, which is what makes
 * cross-feature dispatch — `diagnostics/dispatch-from-effect` ultimately
 * incrementing a `counter` root — a checked call rather than a loose string.
 */
export interface AppContracts extends UkladContracts {
  readonly state: AppState;
  readonly events: AppEvents;

  /**
   * Effect ids and payloads are stable across platforms. `platform/web` and
   * `platform/headless` each register one implementation of every id below, so
   * an event emits the same intent in a browser tab and in a Node process.
   */
  readonly effects: {
    [appIds.effects.diagnosticsDispatchEvent]: AppEventVector;
    /** Diagnostic sink: emitted with no payload, a timestamp, or a draft value. */
    [appIds.effects.diagnosticsSink]: unknown;
    [appIds.effects.storageLocalSet]: { key: string; value: unknown };
    [appIds.effects.documentTitle]: string;
  };

  /**
   * One entry per provider id: what it is injected with, and what it
   * contributes. Because the contract is keyed by provider id, this single
   * declaration types every platform's `regCoeffect` and every event that
   * binds the provider to a local name.
   */
  readonly coeffects: {
    [appIds.coeffects.systemNow]: { arg: void; value: number };
    [appIds.coeffects.storageLocalValue]: { arg: string; value: string | null };
  };

  readonly subscriptions: {
    // Root subscriptions: no parameters, result matches the backing state root.
    [appIds.subscriptions.counterValue]: { params: []; result: CounterValue };
    [appIds.subscriptions.counterEffectDispatches]: {
      params: [];
      result: CounterEffectDispatches;
    };
    [appIds.subscriptions.usersList]: { params: []; result: UsersList };
    [appIds.subscriptions.usersLoading]: { params: []; result: UsersLoading };
    [appIds.subscriptions.collectionsUsers]: { params: []; result: CollectionsUsers };
    [appIds.subscriptions.collectionsPermissions]: { params: []; result: CollectionsPermissions };
    [appIds.subscriptions.collectionsRoles]: { params: []; result: CollectionsRoles };
    [appIds.subscriptions.collectionsUserPermissions]: {
      params: [];
      result: CollectionsUserPermissions;
    };

    // Computed subscriptions.
    [appIds.subscriptions.usersById]: { params: [id: number]; result: User | undefined };
    [appIds.subscriptions.collectionsNested]: { params: []; result: CollectionsNested };
  };
}
