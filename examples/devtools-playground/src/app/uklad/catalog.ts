/**
 * The application catalog: the single place where this app's state roots and
 * runtime handler ids are declared.
 *
 * `stateKeys` names structural properties of the application state — event
 * handlers reach them as `draftState.counterValue`. `appIds` names runtime
 * handlers — registrations, dispatches, subscription queries, and effect
 * tuples address these. `regRootSub` is the one place the two meet, and it
 * maps them explicitly.
 *
 * Every value is a direct string literal so a text search, a partial file
 * read, or a static analysis pass finds the same answer the runtime does.
 * Runtime-owned built-ins (`dispatch`, `dispatch-later`) are deliberately
 * absent.
 */

/** Top-level application state properties. Each one is an independent reactive root. */
export const stateKeys = {
  counterValue: 'counterValue',
  counterEffectDispatches: 'counterEffectDispatches',

  usersList: 'usersList',
  usersLoading: 'usersLoading',

  serverRegion: 'serverRegion',

  collectionsUsers: 'collectionsUsers',
  collectionsPermissions: 'collectionsPermissions',
  collectionsRoles: 'collectionsRoles',
  collectionsUserPermissions: 'collectionsUserPermissions',

  diagnosticsNested: 'diagnosticsNested',
  diagnosticsPayload: 'diagnosticsPayload',
  diagnosticsImmerProbe: 'diagnosticsImmerProbe',
  diagnosticsComplex: 'diagnosticsComplex',
} as const;

/** Application-defined event, subscription, effect, and coeffect handler ids. */
export const appIds = {
  events: {
    counterIncrement: 'counter/increment',
    counterPersist: 'counter/persist',
    counterLoad: 'counter/load',
    counterEffectDispatched: 'counter/effect-dispatched',

    usersToggle: 'users/toggle',
    usersAdd: 'users/add',
    usersSetLoading: 'users/set-loading',

    serverRegionSelected: 'server/region-selected',

    collectionsAddUser: 'collections/add-user',
    collectionsRemoveUser: 'collections/remove-user',
    collectionsUpdateUser: 'collections/update-user',
    collectionsAddPermission: 'collections/add-permission',
    collectionsRemovePermission: 'collections/remove-permission',
    collectionsAssignRole: 'collections/assign-role',

    diagnosticsDispatchFromEffect: 'diagnostics/dispatch-from-effect',
    diagnosticsSimulateError: 'diagnostics/simulate-error',
    diagnosticsEmitSink: 'diagnostics/emit-sink',
    diagnosticsBadParams: 'diagnostics/bad-params',
    diagnosticsImmerProxy: 'diagnostics/immer-proxy',
    diagnosticsWriteNested: 'diagnostics/write-nested',
    diagnosticsCreateComplex: 'diagnostics/create-complex-structure',
  },
  subscriptions: {
    counterValue: 'counter/value',
    counterEffectDispatches: 'counter/effect-dispatches',

    usersList: 'users/list',
    usersLoading: 'users/loading',
    usersById: 'users/by-id',

    serverClock: 'server/clock',
    serverItemById: 'server/item-by-id',
    serverRegion: 'server/region',
    serverRegionSummary: 'server/region-summary',

    collectionsUsers: 'collections/users',
    collectionsPermissions: 'collections/permissions',
    collectionsRoles: 'collections/roles',
    collectionsUserPermissions: 'collections/user-permissions',
    collectionsNested: 'collections/nested',
  },
  effects: {
    diagnosticsDispatchEvent: 'diagnostics/dispatch-event',
    diagnosticsSink: 'diagnostics/sink',
    storageLocalSet: 'storage/local-set',
    documentTitle: 'document/title',
  },
  coeffects: {
    systemNow: 'system/now',
    storageLocalValue: 'storage/local-value',
  },
} as const;
