import { regEffect, regEvent, NOW } from "@flexsurfer/reflex";

// Event handlers
regEvent('increment-counter', (coeffects) => {
  const { draftDb } = coeffects;
  draftDb.counter = draftDb.counter + 1;
  draftDb.field1 = {};
  draftDb.field1.field2 = "test";
  draftDb.field1.field4 = {};
  draftDb.field1.field4.field3 = "test2";
});

regEvent('toggle-user', (coeffects, userId: number) => {
  const { draftDb } = coeffects;
  const user = draftDb.users.find((u: any) => u.id === userId);
  if (user) {
    user.active = !user.active;
  }
});

regEvent('set-loading', (coeffects, isLoading: boolean) => {
  const { draftDb } = coeffects;
  draftDb.isLoading = isLoading;
  return [['fake-effect']];
});

regEvent('add-user', (coeffects, newUser: any) => {
  const { draftDb } = coeffects;
  draftDb.users.push(newUser);
});

regEvent('simulate-error', () => {
  throw new Error('This is a simulated error for testing');
});

regEvent('fake-event', ({now}) => {
  return [['fake-effect', now]];
}, [[NOW]]);

regEvent('test-event-with-bad-params', ({draftDb}, badPayload: any) => {
  draftDb.badPayload = badPayload;
});

regEvent('test-event-with-immer-proxy', ({draftDb}) => {
  return [['fake-effect', draftDb.immerPayloadTest]];
});

// Map and Set manipulation events
regEvent('add-user-to-map', ({draftDb}, userId: string, userData: any) => {
  if (!draftDb.userMap) {
    draftDb.userMap = new Map();
  }
  draftDb.userMap.set(userId, userData);
});

regEvent('remove-user-from-map', ({draftDb}, userId: string) => {
  if (draftDb.userMap) {
    draftDb.userMap.delete(userId);
  }
});

regEvent('update-user-in-map', ({draftDb}, userId: string, updates: any) => {
  if (draftDb.userMap && draftDb.userMap.has(userId)) {
    const user = draftDb.userMap.get(userId);
    Object.assign(user, updates);
  }
});

regEvent('add-permission', ({draftDb}, permission: string) => {
  if (!draftDb.permissionsSet) {
    draftDb.permissionsSet = new Set();
  }
  draftDb.permissionsSet.add(permission);
});

regEvent('remove-permission', ({draftDb}, permission: string) => {
  if (draftDb.permissionsSet) {
    draftDb.permissionsSet.delete(permission);
  }
});

regEvent('toggle-user-role', ({draftDb}, userId: string, newRole: string) => {
  if (draftDb.nestedCollections?.userPermissions && draftDb.nestedCollections?.rolesMap) {
    const rolePermissions = draftDb.nestedCollections.rolesMap.get(newRole);
    if (rolePermissions) {
      draftDb.nestedCollections.userPermissions.set(userId, new Set(rolePermissions));
    }
  }
});

regEvent('create-complex-map-set-structure', ({draftDb}) => {
  // Create a complex nested structure with Maps and Sets
  const projectsMap = new Map<string, any>();
  projectsMap.set('project-1', {
    name: 'Website Redesign',
    members: new Set(['alice', 'bob', 'charlie']),
    tasks: new Map([
      ['task-1', { title: 'Design mockups', status: 'completed' }],
      ['task-2', { title: 'Implement frontend', status: 'in-progress' }]
    ])
  });
  projectsMap.set('project-2', {
    name: 'API Development',
    members: new Set(['bob', 'diana']),
    tasks: new Map([
      ['task-3', { title: 'Design endpoints', status: 'completed' }],
      ['task-4', { title: 'Write documentation', status: 'pending' }]
    ])
  });

  const featuresMap = new Map<string, any>();
  featuresMap.set('dashboard', true);
  featuresMap.set('reports', false);
  featuresMap.set('analytics', new Set(['basic', 'advanced']));

  const settingsMap = new Map<string, any>();
  settingsMap.set('theme', 'dark');
  settingsMap.set('notifications', new Set(['email', 'push']));
  settingsMap.set('features', featuresMap);

  draftDb.complexData = new Map<string, any>();
  draftDb.complexData.set('projects', projectsMap);
  draftDb.complexData.set('settings', settingsMap);
});

// Persistence pair exercising the browser/headless effect adapter split:
// the handlers only emit/consume the effect contract; whether that hits
// window.localStorage or an in-memory map is decided by which adapter
// module the entry point imported (effects.browser.ts vs effects.headless.ts).
regEvent('persist-counter', ({draftDb}) => {
  return [
    ['local-storage-set', { key: 'test-app.counter', value: draftDb.counter }],
    ['set-document-title', `Counter: ${draftDb.counter}`]
  ];
});

regEvent('load-counter', ({draftDb, localStorageValue}) => {
  if (localStorageValue != null) {
    draftDb.counter = JSON.parse(localStorageValue);
  }
}, [['local-storage-get', 'test-app.counter']]);

// Runtime-agnostic effect, registered once for both runtimes
regEffect('fake-effect', (param) => {
  console.log('fake-effect', param);
});