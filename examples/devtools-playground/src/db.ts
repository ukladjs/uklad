import { initAppDb } from "@flexsurfer/reflex";

// Initialize the app database
initAppDb({
    users: [
      { id: 1, name: 'John Doe', active: true },
      { id: 2, name: 'Jane Smith', active: false },
      { id: 3, name: 'Bob Johnson', active: true }
    ],
    counter: 0,
    isLoading: false,
    immerPayloadTest: {test: 'test'},
    // Map and Set test data
    userMap: new Map([
      ['user-1', { id: 1, name: 'Alice', role: 'admin' }],
      ['user-2', { id: 2, name: 'Bob', role: 'user' }],
      ['user-3', { id: 3, name: 'Charlie', role: 'moderator' }]
    ]),
    permissionsSet: new Set(['read', 'write', 'delete']),
    nestedCollections: {
      rolesMap: new Map([
        ['admin', new Set(['create', 'read', 'update', 'delete'])],
        ['user', new Set(['read', 'update'])],
        ['guest', new Set(['read'])]
      ]),
      userPermissions: new Map([
        ['alice', new Set(['read', 'write'])],
        ['bob', new Set(['read'])],
        ['charlie', new Set(['read', 'write', 'delete'])]
      ])
    }
  });