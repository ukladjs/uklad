import { produce } from 'immer';
import { initAppDb, getAppDb, updateAppDb as commitAppDb } from './runtime-test-api';
interface TestAppState {
  counter: number;
  todos: Array<{
    id: number;
    text: string;
    completed: boolean;
  }>;
  user: {
    name: string;
    email: string;
    profile?: {
      age: number;
      location: string;
    };
    preferences?: {
      theme: 'light' | 'dark';
      notifications: boolean;
    };
  };
}

interface SimpleState {
  count: number;
  message: string;
}

function updateAppDb<T = Record<string, any>>(updater: (draft: T) => void) {
  const initialDb = getAppDb();
  const newDb = produce(initialDb, updater);
  commitAppDb(newDb);
}

describe('Immer integration', () => {
  beforeEach(() => {
    initAppDb({
      counter: 0,
      todos: [],
      user: { name: 'John', email: 'john@example.com' },
    });
  });

  test('updateAppDb should immutably update the database', () => {
    const initialDb = getAppDb();

    updateAppDb((draft) => {
      draft.counter = 10;
      draft.user.name = 'Jane';
    });

    const updatedDb = getAppDb();

    expect(initialDb.counter).toBe(0);
    expect(initialDb.user.name).toBe('John');

    expect(updatedDb.counter).toBe(10);
    expect(updatedDb.user.name).toBe('Jane');
    expect(updatedDb.user.email).toBe('john@example.com');

    expect(initialDb).not.toBe(updatedDb);
    expect(initialDb.user).not.toBe(updatedDb.user);
  });

  test('updateAppDb should handle array mutations', () => {
    updateAppDb((draft) => {
      draft.todos.push({ id: 1, text: 'Learn Immer', completed: false });
      draft.todos.push({ id: 2, text: 'Build app', completed: true });
    });

    const db = getAppDb();
    expect(db.todos).toHaveLength(2);
    expect(db.todos[0]).toEqual({ id: 1, text: 'Learn Immer', completed: false });
    expect(db.todos[1]).toEqual({ id: 2, text: 'Build app', completed: true });
  });

  test('updateAppDb should handle nested object updates', () => {
    updateAppDb((draft) => {
      draft.user.profile = { age: 30, location: 'SF' };
      draft.user.preferences = { theme: 'dark', notifications: true };
    });

    const db = getAppDb();
    expect(db.user.profile).toEqual({ age: 30, location: 'SF' });
    expect(db.user.preferences).toEqual({ theme: 'dark', notifications: true });
    expect(db.user.name).toBe('John');
  });

  test('multiple updateAppDb calls should chain correctly', () => {
    updateAppDb((draft) => {
      draft.counter = 5;
    });

    updateAppDb((draft) => {
      draft.counter += 10;
    });

    updateAppDb((draft) => {
      draft.user.name = 'Bob';
    });

    const db = getAppDb();
    expect(db.counter).toBe(15);
    expect(db.user.name).toBe('Bob');
  });
});

describe('Type-safe AppDB', () => {
  describe('Type-safe initialization and retrieval', () => {
    test('should initialize and retrieve type-safe database', () => {
      const initialState: TestAppState = {
        counter: 42,
        todos: [
          { id: 1, text: 'Learn TypeScript', completed: false },
          { id: 2, text: 'Write tests', completed: true },
        ],
        user: {
          name: 'Alice',
          email: 'alice@example.com',
        },
      };

      initAppDb<TestAppState>(initialState);
      const db = getAppDb<TestAppState>();

      expect(db.counter).toBe(42);
      expect(db.todos).toHaveLength(2);
      expect(db.todos[0]!.text).toBe('Learn TypeScript');
      expect(db.user.name).toBe('Alice');
      expect(db.user.email).toBe('alice@example.com');
    });

    test('should work with simple state interface', () => {
      const simpleState: SimpleState = {
        count: 100,
        message: 'Hello World',
      };

      initAppDb<SimpleState>(simpleState);
      const db = getAppDb<SimpleState>();

      expect(db.count).toBe(100);
      expect(db.message).toBe('Hello World');
    });
  });

  describe('Type-safe updates', () => {
    beforeEach(() => {
      const initialState: TestAppState = {
        counter: 0,
        todos: [],
        user: {
          name: 'Bob',
          email: 'bob@example.com',
        },
      };
      initAppDb<TestAppState>(initialState);
    });

    test('should handle type-safe counter updates', () => {
      updateAppDb<TestAppState>((draft) => {
        draft.counter += 10;
      });

      const db = getAppDb<TestAppState>();
      expect(db.counter).toBe(10);
    });

    test('should handle type-safe array operations', () => {
      updateAppDb<TestAppState>((draft) => {
        draft.todos.push({
          id: 1,
          text: 'First todo',
          completed: false,
        });
      });

      updateAppDb<TestAppState>((draft) => {
        draft.todos[0]!.completed = true;
        draft.todos.push({
          id: 2,
          text: 'Second todo',
          completed: false,
        });
      });

      const db = getAppDb<TestAppState>();
      expect(db.todos).toHaveLength(2);
      expect(db.todos[0]!.completed).toBe(true);
      expect(db.todos[1]!.text).toBe('Second todo');
    });

    test('should handle type-safe nested object updates', () => {
      updateAppDb<TestAppState>((draft) => {
        draft.user.name = 'Charlie';
        draft.user.profile = {
          age: 25,
          location: 'New York',
        };
        draft.user.preferences = {
          theme: 'dark',
          notifications: true,
        };
      });

      const db = getAppDb<TestAppState>();
      expect(db.user.name).toBe('Charlie');
      expect(db.user.profile?.age).toBe(25);
      expect(db.user.profile?.location).toBe('New York');
      expect(db.user.preferences?.theme).toBe('dark');
      expect(db.user.preferences?.notifications).toBe(true);
    });

    test('should maintain immutability with type-safe updates', () => {
      const initialDb = getAppDb<TestAppState>();

      updateAppDb<TestAppState>((draft) => {
        draft.counter = 99;
        draft.user.name = 'David';
      });

      const updatedDb = getAppDb<TestAppState>();

      expect(initialDb.counter).toBe(0);
      expect(initialDb.user.name).toBe('Bob');

      expect(updatedDb.counter).toBe(99);
      expect(updatedDb.user.name).toBe('David');

      expect(initialDb).not.toBe(updatedDb);
      expect(initialDb.user).not.toBe(updatedDb.user);
    });
  });

  describe('Mixed usage patterns', () => {
    test('should handle switching between different typed states', () => {
      const testState: TestAppState = {
        counter: 1,
        todos: [],
        user: { name: 'Test', email: 'test@example.com' },
      };
      initAppDb<TestAppState>(testState);
      const db1 = getAppDb<TestAppState>();
      expect(db1.counter).toBe(1);

      const simpleState: SimpleState = {
        count: 200,
        message: 'New state',
      };
      initAppDb<SimpleState>(simpleState);
      const db2 = getAppDb<SimpleState>();
      expect(db2.count).toBe(200);
      expect(db2.message).toBe('New state');
    });

    test('should work with partial state initialization', () => {
      initAppDb<TestAppState>({
        counter: 5,
        todos: [],
        user: { name: 'Minimal', email: 'min@example.com' },
      });

      const db = getAppDb<TestAppState>();
      expect(db.counter).toBe(5);
      expect(db.user.name).toBe('Minimal');
      expect(db.user.profile).toBeUndefined();
      expect(db.user.preferences).toBeUndefined();
    });
  });

  describe('Backward compatibility', () => {
    test('should maintain backward compatibility without type parameters', () => {
      initAppDb({
        anything: 'goes',
        counter: 123,
        nested: { prop: 'value' },
      });

      const db = getAppDb();
      expect(db.anything).toBe('goes');
      expect(db.counter).toBe(123);
      expect(db.nested.prop).toBe('value');

      updateAppDb((draft) => {
        draft.counter = 456;
        draft.newProp = 'added';
      });

      const updatedDb = getAppDb();
      expect(updatedDb.counter).toBe(456);
      expect(updatedDb.newProp).toBe('added');
    });

    test('should allow mixed typed and untyped operations', () => {
      initAppDb({ counter: 10, data: 'test' });

      updateAppDb<any>((draft) => {
        draft.counter += 5;
        draft.typed = true;
      });

      const db = getAppDb();
      expect(db.counter).toBe(15);
      expect(db.data).toBe('test');
      expect(db.typed).toBe(true);
    });
  });
});
