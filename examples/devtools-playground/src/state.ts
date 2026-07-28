import type { ReflexContracts } from '@flexsurfer/reflex/vanilla';

/** One entry in the `users` list. */
export interface PlaygroundUser {
  id: number;
  name: string;
  active: boolean;
}

/** One entry in the Map-backed `userMap` collection. */
export interface PlaygroundMapUser {
  id: number;
  name: string;
  role: string;
}

/** The nested Map/Set structure used to exercise devtools rendering. */
export interface PlaygroundNestedCollections {
  rolesMap: Map<string, Set<string>>;
  userPermissions: Map<string, Set<string>>;
}

// The index signature stays: several handlers deliberately write undeclared
// keys (`field1`, `badPayload`, `complexData`) to exercise devtools rendering
// of state shapes the contract does not describe.
export interface PlaygroundState extends Record<string, any> {
  users: PlaygroundUser[];
  counter: number;
  effectDispatchCount: number;
  isLoading: boolean;
  immerPayloadTest: { test: string };
  userMap: Map<string, PlaygroundMapUser>;
  permissionsSet: Set<string>;
  nestedCollections: PlaygroundNestedCollections;
}

export interface PlaygroundEvents {
  'increment-counter': [];
  'dispatch-event-from-effect': [];
  'effect-dispatched': [];
  'toggle-user': [userId: number];
  'set-loading': [isLoading: boolean];
  'add-user': [user: PlaygroundUser];
  'simulate-error': [];
  'test-event-with-immer-proxy': [];
  // Intentionally unconstrained: these two exist so the dashboard and the
  // bad-payload warning path can be driven with arbitrary payloads.
  'fake-event': any[];
  'test-event-with-bad-params': any[];
  'add-user-to-map': [userId: string, userData: PlaygroundMapUser];
  'remove-user-from-map': [userId: string];
  'update-user-in-map': [userId: string, updates: Partial<PlaygroundMapUser>];
  'add-permission': [permission: string];
  'remove-permission': [permission: string];
  'toggle-user-role': [userId: string, newRole: string];
  'create-complex-map-set-structure': [];
  'persist-counter': [];
  'load-counter': [];
}

/** Every declared event as a dispatchable vector. */
export type PlaygroundEventVector = {
  [TId in keyof PlaygroundEvents]: [id: TId, ...params: PlaygroundEvents[TId]];
}[keyof PlaygroundEvents];

/**
 * Effect ids are registered twice — once by `effects.browser.ts` against real
 * browser APIs, once by `effects.headless.ts` against Node-safe adapters — so
 * this map is the contract both adapters must satisfy.
 */
export interface PlaygroundEffects {
  'dispatch-event-effect': PlaygroundEventVector;
  'local-storage-set': { key: string; value: unknown };
  'set-document-title': string;
  /** Diagnostic sink: emitted with no payload, a timestamp, or a draft value. */
  'fake-effect': any;
}

export interface PlaygroundSubscriptions {
  users: { params: []; result: PlaygroundUser[] };
  counter: { params: []; result: number };
  effectDispatchCount: { params: []; result: number };
  isLoading: { params: []; result: boolean };
  nestedCollections: { params: []; result: PlaygroundNestedCollections };
  userMap: { params: []; result: Map<string, PlaygroundMapUser> };
  permissionsSet: { params: []; result: Set<string> };
  'user-by-id': { params: [id: number]; result: PlaygroundUser | undefined };
  'nestedCollections-comp': { params: []; result: PlaygroundNestedCollections };
}

export interface PlaygroundContracts extends ReflexContracts {
  readonly state: PlaygroundState;
  readonly events: PlaygroundEvents;
  readonly effects: PlaygroundEffects;
  readonly subscriptions: PlaygroundSubscriptions;
}

/** Create fresh state for one independently owned playground runtime. */
export function createInitialState(): PlaygroundState {
  return {
    users: [
      { id: 1, name: 'John Doe', active: true },
      { id: 2, name: 'Jane Smith', active: false },
      { id: 3, name: 'Bob Johnson', active: true },
    ],
    counter: 0,
    effectDispatchCount: 0,
    isLoading: false,
    immerPayloadTest: { test: 'test' },
    // Map and Set test data
    userMap: new Map([
      ['user-1', { id: 1, name: 'Alice', role: 'admin' }],
      ['user-2', { id: 2, name: 'Bob', role: 'user' }],
      ['user-3', { id: 3, name: 'Charlie', role: 'moderator' }],
    ]),
    permissionsSet: new Set(['read', 'write', 'delete']),
    nestedCollections: {
      rolesMap: new Map([
        ['admin', new Set(['create', 'read', 'update', 'delete'])],
        ['user', new Set(['read', 'update'])],
        ['guest', new Set(['read'])],
      ]),
      userPermissions: new Map([
        ['alice', new Set(['read', 'write'])],
        ['bob', new Set(['read'])],
        ['charlie', new Set(['read', 'write', 'delete'])],
      ]),
    },
  };
}
