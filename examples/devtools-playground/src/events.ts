import { NOW, type ReflexRuntime } from '@flexsurfer/reflex/vanilla';
import type { PlaygroundContracts } from './state';

/** Install the environment-independent event and effect handlers. */
export function installPlaygroundEvents(runtime: ReflexRuntime<PlaygroundContracts>): void {
  runtime.regEvent('increment-counter', (coeffects) => {
    const { draftState } = coeffects;
    draftState.counter = draftState.counter + 1;
    draftState.field1 = {};
    draftState.field1.field2 = 'test';
    draftState.field1.field4 = {};
    draftState.field1.field4.field3 = 'test2';
  });

  runtime.regEvent('toggle-user', (coeffects, userId: number) => {
    const { draftState } = coeffects;
    const user = draftState.users.find((u: any) => u.id === userId);
    if (user) {
      user.active = !user.active;
    }
  });

  runtime.regEvent('set-loading', (coeffects, isLoading: boolean) => {
    const { draftState } = coeffects;
    draftState.isLoading = isLoading;
    return [['fake-effect']];
  });

  runtime.regEvent('add-user', (coeffects, newUser: any) => {
    const { draftState } = coeffects;
    draftState.users.push(newUser);
  });

  runtime.regEvent('simulate-error', () => {
    throw new Error('This is a simulated error for testing');
  });

  runtime.regEvent(
    'fake-event',
    ({ now }) => {
      return [['fake-effect', now]];
    },
    { coeffects: [[NOW]] },
  );

  runtime.regEvent('test-event-with-bad-params', ({ draftState }, badPayload: any) => {
    draftState.badPayload = badPayload;
  });

  runtime.regEvent('test-event-with-immer-proxy', ({ draftState }) => {
    return [['fake-effect', draftState.immerPayloadTest]];
  });

  // Map and Set manipulation events
  runtime.regEvent('add-user-to-map', ({ draftState }, userId: string, userData: any) => {
    if (!draftState.userMap) {
      draftState.userMap = new Map();
    }
    draftState.userMap.set(userId, userData);
  });

  runtime.regEvent('remove-user-from-map', ({ draftState }, userId: string) => {
    if (draftState.userMap) {
      draftState.userMap.delete(userId);
    }
  });

  runtime.regEvent('update-user-in-map', ({ draftState }, userId: string, updates: any) => {
    if (draftState.userMap && draftState.userMap.has(userId)) {
      const user = draftState.userMap.get(userId);
      if (user) Object.assign(user, updates);
    }
  });

  runtime.regEvent('add-permission', ({ draftState }, permission: string) => {
    if (!draftState.permissionsSet) {
      draftState.permissionsSet = new Set();
    }
    draftState.permissionsSet.add(permission);
  });

  runtime.regEvent('remove-permission', ({ draftState }, permission: string) => {
    if (draftState.permissionsSet) {
      draftState.permissionsSet.delete(permission);
    }
  });

  runtime.regEvent('toggle-user-role', ({ draftState }, userId: string, newRole: string) => {
    if (draftState.nestedCollections?.userPermissions && draftState.nestedCollections?.rolesMap) {
      const rolePermissions = draftState.nestedCollections.rolesMap.get(newRole);
      if (rolePermissions) {
        draftState.nestedCollections.userPermissions.set(userId, new Set(rolePermissions));
      }
    }
  });

  runtime.regEvent('create-complex-map-set-structure', ({ draftState }) => {
    // Create a complex nested structure with Maps and Sets
    const projectsMap = new Map<string, any>();
    projectsMap.set('project-1', {
      name: 'Website Redesign',
      members: new Set(['alice', 'bob', 'charlie']),
      tasks: new Map([
        ['task-1', { title: 'Design mockups', status: 'completed' }],
        ['task-2', { title: 'Implement frontend', status: 'in-progress' }],
      ]),
    });
    projectsMap.set('project-2', {
      name: 'API Development',
      members: new Set(['bob', 'diana']),
      tasks: new Map([
        ['task-3', { title: 'Design endpoints', status: 'completed' }],
        ['task-4', { title: 'Write documentation', status: 'pending' }],
      ]),
    });

    const featuresMap = new Map<string, any>();
    featuresMap.set('dashboard', true);
    featuresMap.set('reports', false);
    featuresMap.set('analytics', new Set(['basic', 'advanced']));

    const settingsMap = new Map<string, any>();
    settingsMap.set('theme', 'dark');
    settingsMap.set('notifications', new Set(['email', 'push']));
    settingsMap.set('features', featuresMap);

    draftState.complexData = new Map<string, any>();
    draftState.complexData.set('projects', projectsMap);
    draftState.complexData.set('settings', settingsMap);
  });

  // Persistence pair exercising the browser/headless effect adapter split:
  // the handlers only emit/consume the effect contract; whether that hits
  // window.localStorage or an in-memory map is decided by which adapter
  // module the entry point imported (effects.browser.ts vs effects.headless.ts).
  runtime.regEvent('persist-counter', ({ draftState }) => {
    return [
      ['local-storage-set', { key: 'test-app.counter', value: draftState.counter }],
      ['set-document-title', `Counter: ${draftState.counter}`],
    ];
  });

  runtime.regEvent(
    'load-counter',
    ({ draftState, localStorageValue }) => {
      if (localStorageValue != null) {
        draftState.counter = JSON.parse(localStorageValue);
      }
    },
    { coeffects: [['local-storage-get', 'test-app.counter']] },
  );

  // Runtime-agnostic effect, registered once for both runtimes
  runtime.regEffect('fake-effect', (param) => {
    console.log('fake-effect', param);
  });
}
