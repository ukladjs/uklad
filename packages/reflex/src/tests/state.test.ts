import { produce } from 'immer';
import { initState, getState, updateState as commitAppState } from './runtime-test-api';
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

function updateState<T = Record<string, any>>(updater: (draft: T) => void) {
  const initialState = getState();
  const newState = produce(initialState, updater);
  commitAppState(newState);
}

describe('Immer integration', () => {
  beforeEach(() => {
    initState({
      counter: 0,
      todos: [],
      user: { name: 'John', email: 'john@example.com' },
    });
  });

  test('updateState should immutably update the state', () => {
    const initialState = getState();

    updateState((draft) => {
      draft.counter = 10;
      draft.user.name = 'Jane';
    });

    const updatedState = getState();

    expect(initialState.counter).toBe(0);
    expect(initialState.user.name).toBe('John');

    expect(updatedState.counter).toBe(10);
    expect(updatedState.user.name).toBe('Jane');
    expect(updatedState.user.email).toBe('john@example.com');

    expect(initialState).not.toBe(updatedState);
    expect(initialState.user).not.toBe(updatedState.user);
  });

  test('updateState should handle array mutations', () => {
    updateState((draft) => {
      draft.todos.push({ id: 1, text: 'Learn Immer', completed: false });
      draft.todos.push({ id: 2, text: 'Build app', completed: true });
    });

    const state = getState();
    expect(state.todos).toHaveLength(2);
    expect(state.todos[0]).toEqual({ id: 1, text: 'Learn Immer', completed: false });
    expect(state.todos[1]).toEqual({ id: 2, text: 'Build app', completed: true });
  });

  test('updateState should handle nested object updates', () => {
    updateState((draft) => {
      draft.user.profile = { age: 30, location: 'SF' };
      draft.user.preferences = { theme: 'dark', notifications: true };
    });

    const state = getState();
    expect(state.user.profile).toEqual({ age: 30, location: 'SF' });
    expect(state.user.preferences).toEqual({ theme: 'dark', notifications: true });
    expect(state.user.name).toBe('John');
  });

  test('multiple updateState calls should chain correctly', () => {
    updateState((draft) => {
      draft.counter = 5;
    });

    updateState((draft) => {
      draft.counter += 10;
    });

    updateState((draft) => {
      draft.user.name = 'Bob';
    });

    const state = getState();
    expect(state.counter).toBe(15);
    expect(state.user.name).toBe('Bob');
  });
});

describe('Type-safe AppSTATE', () => {
  describe('Type-safe initialization and retrieval', () => {
    test('should initialize and retrieve type-safe state', () => {
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

      initState<TestAppState>(initialState);
      const state = getState<TestAppState>();

      expect(state.counter).toBe(42);
      expect(state.todos).toHaveLength(2);
      expect(state.todos[0]!.text).toBe('Learn TypeScript');
      expect(state.user.name).toBe('Alice');
      expect(state.user.email).toBe('alice@example.com');
    });

    test('should work with simple state interface', () => {
      const simpleState: SimpleState = {
        count: 100,
        message: 'Hello World',
      };

      initState<SimpleState>(simpleState);
      const state = getState<SimpleState>();

      expect(state.count).toBe(100);
      expect(state.message).toBe('Hello World');
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
      initState<TestAppState>(initialState);
    });

    test('should handle type-safe counter updates', () => {
      updateState<TestAppState>((draft) => {
        draft.counter += 10;
      });

      const state = getState<TestAppState>();
      expect(state.counter).toBe(10);
    });

    test('should handle type-safe array operations', () => {
      updateState<TestAppState>((draft) => {
        draft.todos.push({
          id: 1,
          text: 'First todo',
          completed: false,
        });
      });

      updateState<TestAppState>((draft) => {
        draft.todos[0]!.completed = true;
        draft.todos.push({
          id: 2,
          text: 'Second todo',
          completed: false,
        });
      });

      const state = getState<TestAppState>();
      expect(state.todos).toHaveLength(2);
      expect(state.todos[0]!.completed).toBe(true);
      expect(state.todos[1]!.text).toBe('Second todo');
    });

    test('should handle type-safe nested object updates', () => {
      updateState<TestAppState>((draft) => {
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

      const state = getState<TestAppState>();
      expect(state.user.name).toBe('Charlie');
      expect(state.user.profile?.age).toBe(25);
      expect(state.user.profile?.location).toBe('New York');
      expect(state.user.preferences?.theme).toBe('dark');
      expect(state.user.preferences?.notifications).toBe(true);
    });

    test('should maintain immutability with type-safe updates', () => {
      const initialState = getState<TestAppState>();

      updateState<TestAppState>((draft) => {
        draft.counter = 99;
        draft.user.name = 'David';
      });

      const updatedState = getState<TestAppState>();

      expect(initialState.counter).toBe(0);
      expect(initialState.user.name).toBe('Bob');

      expect(updatedState.counter).toBe(99);
      expect(updatedState.user.name).toBe('David');

      expect(initialState).not.toBe(updatedState);
      expect(initialState.user).not.toBe(updatedState.user);
    });
  });

  describe('Mixed usage patterns', () => {
    test('should handle switching between different typed states', () => {
      const testState: TestAppState = {
        counter: 1,
        todos: [],
        user: { name: 'Test', email: 'test@example.com' },
      };
      initState<TestAppState>(testState);
      const db1 = getState<TestAppState>();
      expect(db1.counter).toBe(1);

      const simpleState: SimpleState = {
        count: 200,
        message: 'New state',
      };
      initState<SimpleState>(simpleState);
      const db2 = getState<SimpleState>();
      expect(db2.count).toBe(200);
      expect(db2.message).toBe('New state');
    });

    test('should work with partial state initialization', () => {
      initState<TestAppState>({
        counter: 5,
        todos: [],
        user: { name: 'Minimal', email: 'min@example.com' },
      });

      const state = getState<TestAppState>();
      expect(state.counter).toBe(5);
      expect(state.user.name).toBe('Minimal');
      expect(state.user.profile).toBeUndefined();
      expect(state.user.preferences).toBeUndefined();
    });
  });

  describe('Backward compatibility', () => {
    test('should maintain backward compatibility without type parameters', () => {
      initState({
        anything: 'goes',
        counter: 123,
        nested: { prop: 'value' },
      });

      const state = getState();
      expect(state.anything).toBe('goes');
      expect(state.counter).toBe(123);
      expect(state.nested.prop).toBe('value');

      updateState((draft) => {
        draft.counter = 456;
        draft.newProp = 'added';
      });

      const updatedState = getState();
      expect(updatedState.counter).toBe(456);
      expect(updatedState.newProp).toBe('added');
    });

    test('should allow mixed typed and untyped operations', () => {
      initState({ counter: 10, data: 'test' });

      updateState<any>((draft) => {
        draft.counter += 5;
        draft.typed = true;
      });

      const state = getState();
      expect(state.counter).toBe(15);
      expect(state.data).toBe('test');
      expect(state.typed).toBe(true);
    });
  });
});
