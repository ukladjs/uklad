/**
 * @jest-environment jsdom
 */
import { renderHook, cleanup, act, waitFor } from '@testing-library/react';
import { regSub } from '../subs';
import { initAppDb } from '../db';
import { useSubscription } from '../hook';
import { regEvent } from '../events';
import { dispatch } from '../router';
import { hasHandler, hasCachedSubscription } from '../registrar';
import { waitForAnimationFrame, waitForEventAndSubscription } from './test-utils';

describe('React Hooks', () => {
  // Register test subscriptions
  regSub('user');
  regSub(
    'user-name',
    (user) => user?.name,
    () => [['user']],
  );
  regSub('user-email-str', 'userEmail'); // Test string computeFn - simple field name
  regSub('todos');
  regSub(
    'todos-count',
    (todos) => (todos || []).length,
    () => [['todos']],
  );

  beforeEach(() => {
    // Set up test data
    initAppDb({
      user: {
        name: 'John Doe',
        email: 'john@example.com',
      },
      userEmail: 'john@example.com', // For string-based subscription test
      todos: [{ id: 1, text: 'Test todo', completed: false }],
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('useSubscription', () => {
    it('should return current root subscription value', () => {
      const { result } = renderHook(() => useSubscription(['user']));

      expect(result.current).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should return derived subscription value', () => {
      const { result } = renderHook(() => useSubscription(['user-name']));

      expect(result.current).toBe('John Doe');
    });

    it('should return array subscription value', () => {
      const { result } = renderHook(() => useSubscription(['todos']));

      expect(result.current).toEqual([{ id: 1, text: 'Test todo', completed: false }]);
    });

    it('should return computed subscription value', () => {
      const { result } = renderHook(() => useSubscription(['todos-count']));

      expect(result.current).toBe(1);
    });

    it('should return string-based subscription value', () => {
      const { result } = renderHook(() => useSubscription(['user-email-str']));

      expect(result.current).toBe('john@example.com');
    });

    it('should update string-based root subscription when source field changes', async () => {
      const { result } = renderHook(() => useSubscription(['user-email-str']));

      expect(result.current).toBe('john@example.com');

      regEvent('set-user-email', ({ draftDb }, email) => {
        draftDb.userEmail = email;
      });

      act(() => {
        dispatch(['set-user-email', 'jane@example.com']);
      });

      await waitFor(() => {
        expect(result.current).toBe('jane@example.com');
      });
    });

    it('should reject duplicate root-key registration with different sub ids', () => {
      regSub('user-email-str-duplicate', 'userEmail');

      expectLogCall(
        'error',
        "[reflex] Subscription 'user-email-str-duplicate' was not registered. Root key 'userEmail' is already used by subscription 'user-email-str'.",
      );
      expect(hasHandler('sub', 'user-email-str-duplicate')).toBe(false);
    });

    it('should handle subscription with parameters', () => {
      // Register a parameterized subscription
      regSub(
        'todo-by-id',
        (todos, id) => {
          return (todos || []).find((todo: any) => todo.id === id);
        },
        () => [['todos']],
      );

      const { result } = renderHook(() => useSubscription(['todo-by-id', 1]));

      expect(result.current).toEqual({
        id: 1,
        text: 'Test todo',
        completed: false,
      });
    });

    it('should handle subscription with deps parameters', () => {
      // Register a subscription that uses parameters in deps function
      regSub(
        'todo-name-by-id',
        (todo) => {
          return todo?.text || null;
        },
        (id) => {
          // Use the id parameter to create dynamic dependencies
          return [['todo-by-id', id]];
        },
      );

      const { result } = renderHook(() => useSubscription(['todo-name-by-id', 1]));

      expect(result.current).toBe('Test todo');
    });

    it('should handle non-existent subscription gracefully', () => {
      const { result } = renderHook(() => useSubscription(['non-existent-sub']));

      // Should return undefined for non-existent subscription
      expect(result.current).toBeUndefined();

      // Should have logged the error
      expectLogCall('error', '[reflex] no sub handler registered for: non-existent-sub');
    });

    it('should update when subscription value changes', async () => {
      const { result } = renderHook(() => useSubscription(['todos-count']));

      expect(result.current).toBe(1);

      regEvent('set-todos', ({ draftDb }) => {
        draftDb.todos = [
          { id: 1, text: 'Test todo', completed: false },
          { id: 2, text: 'Another todo', completed: true },
        ];
      });
      // Update the database using updateAppDb for reactivity
      act(() => {
        dispatch(['set-todos']);
      });

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current).toBe(2);
      });
    });

    it('should handle multiple subscriptions in same component', () => {
      const { result } = renderHook(() => ({
        user: useSubscription<{ name: string; email: string }>(['user']),
        userName: useSubscription<string>(['user-name']),
        todosCount: useSubscription<number>(['todos-count']),
      }));

      expect(result.current.user?.name).toBe('John Doe');
      expect(result.current.userName).toBe('John Doe');
      expect(result.current.todosCount).toBe(1);
    });

    it('should re-render when AppDB changes via event dispatch', async () => {
      // Register an event handler that updates AppDB
      regEvent('add-todo', ({ draftDb }, text) => {
        const currentTodos = draftDb.todos || [];
        const newTodo = {
          id: Date.now(),
          text,
          completed: false,
        };
        draftDb.todos = [...currentTodos, newTodo];
      });

      regEvent('update-user-name', ({ draftDb }, newName) => {
        if (!draftDb.user) draftDb.user = {};
        draftDb.user.name = newName;
      });

      // Set up hook to watch todos count
      const { result } = renderHook(() => ({
        todosCount: useSubscription<number>(['todos-count']),
        userName: useSubscription<string>(['user-name']),
        todos: useSubscription<Array<{ id: number; text: string; completed: boolean }>>(['todos']),
      }));

      // Initial state
      expect(result.current.todosCount).toBe(1);
      expect(result.current.userName).toBe('John Doe');
      expect(result.current.todos).toHaveLength(1);

      // Dispatch event to add a todo
      act(() => {
        dispatch(['add-todo', 'Learn Simple Reactive System']);
      });

      // Wait for event processing and subscription recomputation
      await waitForEventAndSubscription();

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current.todosCount).toBe(2);
        expect(result.current.todos).toHaveLength(2);
        expect(result.current.todos[1]!.text).toBe('Learn Simple Reactive System');
      });

      // Dispatch event to update user name
      act(() => {
        dispatch(['update-user-name', 'Jane Smith']);
      });

      // Wait for event processing and subscription recomputation
      await waitForEventAndSubscription();

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current.userName).toBe('Jane Smith');
        // Todos count should remain the same
        expect(result.current.todosCount).toBe(2);
      });
    });

    it('should handle rapid event dispatches correctly', async () => {
      // Register counter event
      regEvent('increment-counter', ({ draftDb }) => {
        draftDb.counter = (draftDb.counter || 0) + 1;
      });

      regEvent('set-counter', ({ draftDb }, value) => {
        draftDb.counter = value;
      });

      // Register counter subscription
      regSub('counter');

      // Set initial counter
      initAppDb({
        counter: 0,
      });

      const { result } = renderHook(() => ({
        counter: useSubscription(['counter']),
      }));

      expect(result.current.counter).toBe(0);

      // Dispatch multiple increments
      act(() => {
        dispatch(['increment-counter']);
        dispatch(['increment-counter']);
        dispatch(['increment-counter']);
      });

      // Wait for event processing and subscription recomputation
      await waitForEventAndSubscription();

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current.counter).toBe(3);
      });

      // Set counter to specific value
      act(() => {
        dispatch(['set-counter', 10]);
      });

      // Wait for event processing and subscription recomputation
      await waitForEventAndSubscription();

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current.counter).toBe(10);
      });

      // More increments
      act(() => {
        dispatch(['increment-counter']);
        dispatch(['increment-counter']);
      });

      // Wait for event processing and subscription recomputation
      await waitForEventAndSubscription();

      // Wait for the hook to automatically re-render due to subscription changes
      await waitFor(() => {
        expect(result.current.counter).toBe(12);
      });
    });

    it('should re-subscribe when subscription parameters change', async () => {
      regSub(
        'todo-text-by-id',
        (todos, id) => {
          return (todos || []).find((todo: any) => todo.id === id)?.text ?? null;
        },
        () => [['todos']],
      );

      initAppDb({
        todos: [
          { id: 1, text: 'First todo', completed: false },
          { id: 2, text: 'Second todo', completed: true },
        ],
      });

      const { result, rerender } = renderHook(
        ({ id }: { id: number }) => useSubscription<string | null>(['todo-text-by-id', id]),
        { initialProps: { id: 1 } },
      );

      expect(result.current).toBe('First todo');

      // Changing the parameter must switch to the new subscription,
      // not keep returning data for the id captured on first mount
      rerender({ id: 2 });

      expect(result.current).toBe('Second todo');

      // Updates must flow through the re-subscribed subscription
      regEvent('rename-todo-2', ({ draftDb }) => {
        draftDb.todos[1].text = 'Renamed todo';
      });

      act(() => {
        dispatch(['rename-todo-2']);
      });

      await waitFor(() => {
        expect(result.current).toBe('Renamed todo');
      });
    });

    it('should prune cached subscriptions after the last watcher unsubscribes', () => {
      const { unmount } = renderHook(() => useSubscription(['todos-count']));

      expect(hasCachedSubscription(JSON.stringify(['todos-count']))).toBe(true);
      expect(hasCachedSubscription(JSON.stringify(['todos']))).toBe(true);

      unmount();

      // The computed subscription and its now-unused root dependency diverge:
      // Computed cells are terminal and evicted. The lightweight root source
      // cell stays registered so dormant graphs cannot miss DB publications.
      expect(hasCachedSubscription(JSON.stringify(['todos-count']))).toBe(false);
      expect(hasCachedSubscription(JSON.stringify(['todos']))).toBe(true);
    });

    it('should keep shared subscriptions cached while another watcher remains', () => {
      const first = renderHook(() => useSubscription(['todos-count']));
      const second = renderHook(() => useSubscription(['todos-count']));

      first.unmount();

      expect(hasCachedSubscription(JSON.stringify(['todos-count']))).toBe(true);

      second.unmount();

      expect(hasCachedSubscription(JSON.stringify(['todos-count']))).toBe(false);
    });

    it('should render consistent values across subscriptions sharing a dependency', async () => {
      regSub('cons-base');
      regSub(
        'cons-x10',
        (v: number) => v * 10,
        () => [['cons-base']],
      );
      regSub(
        'cons-x100',
        (v: number) => v * 100,
        () => [['cons-base']],
      );

      initAppDb({ 'cons-base': 1 });

      regEvent('cons-set-base', ({ draftDb }, v: number) => {
        draftDb['cons-base'] = v;
      });

      // Record every committed render's pair of values
      const observed: Array<{ a: number; b: number }> = [];
      const { result } = renderHook(() => {
        const a = useSubscription<number>(['cons-x10']);
        const b = useSubscription<number>(['cons-x100']);
        observed.push({ a, b });
        return { a, b };
      });

      expect(result.current).toEqual({ a: 10, b: 100 });

      act(() => {
        dispatch(['cons-set-base', 2]);
      });
      await waitFor(() => {
        expect(result.current).toEqual({ a: 20, b: 200 });
      });

      act(() => {
        dispatch(['cons-set-base', 3]);
      });
      await waitFor(() => {
        expect(result.current).toEqual({ a: 30, b: 300 });
      });

      // No committed render may mix values from different db versions
      for (const { a, b } of observed) {
        expect(b).toBe(a * 10);
      }
    });

    it('should resubscribe correctly after a full unmount/remount cycle', async () => {
      const key = JSON.stringify(['todos-count']);
      const first = renderHook(() => useSubscription<number>(['todos-count']));
      expect(first.result.current).toBe(1);
      first.unmount();
      expect(hasCachedSubscription(key)).toBe(false);

      // Data changes while nothing is mounted
      regEvent('clear-todos', ({ draftDb }) => {
        draftDb.todos = [];
      });
      act(() => {
        dispatch(['clear-todos']);
      });
      await waitForEventAndSubscription();
      // Subscriptions serve the last flushed db generation; wait for the
      // animation-frame flush so the change is visible to new subscribers
      await waitForAnimationFrame();
      await waitForEventAndSubscription();

      // Remount creates a fresh subscription and sees the flushed data
      const second = renderHook(() => useSubscription<number>(['todos-count']));
      expect(second.result.current).toBe(0);
      second.unmount();
    });
  });
});
