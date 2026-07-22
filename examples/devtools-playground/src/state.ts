import type { ReflexContracts } from '@flexsurfer/reflex/vanilla';

export interface PlaygroundState extends Record<string, any> {
  users: Array<{ id: number; name: string; active: boolean }>;
  counter: number;
  isLoading: boolean;
  immerPayloadTest: { test: string };
  userMap: Map<string, { id: number; name: string; role: string }>;
  permissionsSet: Set<string>;
  nestedCollections: {
    rolesMap: Map<string, Set<string>>;
    userPermissions: Map<string, Set<string>>;
  };
}

export interface PlaygroundContracts extends ReflexContracts {
  readonly state: PlaygroundState;
  readonly events: Record<string, readonly any[]>;
  readonly effects: Record<string, any>;
  readonly subscriptions: Record<string, { readonly params: readonly any[]; readonly result: any }>;
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
