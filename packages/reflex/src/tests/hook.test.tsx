/**
 * @jest-environment jsdom
 */
import { renderHook, cleanup, act, waitFor } from '@testing-library/react';
import { useSubscription } from '../react/use-subscription';
import {
  dispatch,
  hasCachedSubscription,
  hasHandler,
  initState,
  ReflexTestProvider,
  regEvent,
  regSub,
} from './runtime-test-api';
import { waitForAnimationFrame, waitForEventAndSubscription } from './test-utils';

describe('React Hooks', () => {
  regSub('user');
  regSub(
    'user-name',
    (user) => user?.name,
    () => [['user']],
  );
  regSub('user-email-str', 'userEmail');
  regSub('todos');
  regSub(
    'todos-count',
    (todos) => (todos || []).length,
    () => [['todos']],
  );

  beforeEach(() => {
    initState({
      user: {
        name: 'John Doe',
        email: 'john@example.com',
      },
      userEmail: 'john@example.com',
      todos: [{ id: 1, text: 'Test todo', completed: false }],
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('useSubscription', () => {
    it('should return current root subscription value', () => {
      const { result } = renderHook(() => useSubscription(['user']), {
        wrapper: ReflexTestProvider,
      });

      expect(result.current).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should return derived subscription value', () => {
      const { result } = renderHook(() => useSubscription(['user-name']), {
        wrapper: ReflexTestProvider,
      });

      expect(result.current).toBe('John Doe');
    });

    it('should return array subscription value', () => {
      const { result } = renderHook(() => useSubscription(['todos']), {
        wrapper: ReflexTestProvider,
      });

      expect(result.current).toEqual([{ id: 1, text: 'Test todo', completed: false }]);
    });

    it('should return computed subscription value', () => {
      const { result } = renderHook(() => useSubscription(['todos-count']), {
        wrapper: ReflexTestProvider,
      });

      expect(result.current).toBe(1);
    });

    it('should return string-based subscription value', () => {
      const { result } = renderHook(() => useSubscription(['user-email-str']), {
        wrapper: ReflexTestProvider,
      });

      expect(result.current).toBe('john@example.com');
    });

    it('should update string-based root subscription when source field changes', async () => {
      const { result } = renderHook(() => useSubscription(['user-email-str']), {
        wrapper: ReflexTestProvider,
      });

      expect(result.current).toBe('john@example.com');

      regEvent('set-user-email', ({ draftState }, email) => {
        draftState.userEmail = email;
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
      regSub(
        'todo-by-id',
        (todos, id) => {
          return (todos || []).find((todo: any) => todo.id === id);
        },
        () => [['todos']],
      );

      const { result } = renderHook(() => useSubscription(['todo-by-id', 1]), {
        wrapper: ReflexTestProvider,
      });

      expect(result.current).toEqual({
        id: 1,
        text: 'Test todo',
        completed: false,
      });
    });

    it('should handle subscription with deps parameters', () => {
      regSub(
        'todo-name-by-id',
        (todo) => {
          return todo?.text || null;
        },
        (id) => {
          return [['todo-by-id', id]];
        },
      );

      const { result } = renderHook(() => useSubscription(['todo-name-by-id', 1]), {
        wrapper: ReflexTestProvider,
      });

      expect(result.current).toBe('Test todo');
    });

    it('should throw for a non-existent subscription', () => {
      // React also reports render errors via console.error; keep output clean
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useSubscription(['non-existent-sub']), { wrapper: ReflexTestProvider });
      }).toThrow("No subscription registered for 'non-existent-sub'");

      consoleError.mockRestore();
    });

    it('should update when subscription value changes', async () => {
      const { result } = renderHook(() => useSubscription(['todos-count']), {
        wrapper: ReflexTestProvider,
      });

      expect(result.current).toBe(1);

      regEvent('set-todos', ({ draftState }) => {
        draftState.todos = [
          { id: 1, text: 'Test todo', completed: false },
          { id: 2, text: 'Another todo', completed: true },
        ];
      });
      act(() => {
        dispatch(['set-todos']);
      });

      await waitFor(() => {
        expect(result.current).toBe(2);
      });
    });

    it('should handle multiple subscriptions in same component', () => {
      const { result } = renderHook(
        () => ({
          user: useSubscription<{ name: string; email: string }>(['user']),
          userName: useSubscription<string>(['user-name']),
          todosCount: useSubscription<number>(['todos-count']),
        }),
        { wrapper: ReflexTestProvider },
      );

      expect(result.current.user?.name).toBe('John Doe');
      expect(result.current.userName).toBe('John Doe');
      expect(result.current.todosCount).toBe(1);
    });

    it('should re-render when AppSTATE changes via event dispatch', async () => {
      regEvent('add-todo', ({ draftState }, text) => {
        const currentTodos = draftState.todos || [];
        const newTodo = {
          id: Date.now(),
          text,
          completed: false,
        };
        draftState.todos = [...currentTodos, newTodo];
      });

      regEvent('update-user-name', ({ draftState }, newName) => {
        if (!draftState.user) draftState.user = {};
        draftState.user.name = newName;
      });

      const { result } = renderHook(
        () => ({
          todosCount: useSubscription<number>(['todos-count']),
          userName: useSubscription<string>(['user-name']),
          todos: useSubscription<Array<{ id: number; text: string; completed: boolean }>>([
            'todos',
          ]),
        }),
        { wrapper: ReflexTestProvider },
      );

      expect(result.current.todosCount).toBe(1);
      expect(result.current.userName).toBe('John Doe');
      expect(result.current.todos).toHaveLength(1);

      act(() => {
        dispatch(['add-todo', 'Learn Simple Reactive System']);
      });

      await waitForEventAndSubscription();

      await waitFor(() => {
        expect(result.current.todosCount).toBe(2);
        expect(result.current.todos).toHaveLength(2);
        expect(result.current.todos[1]!.text).toBe('Learn Simple Reactive System');
      });

      act(() => {
        dispatch(['update-user-name', 'Jane Smith']);
      });

      await waitForEventAndSubscription();

      await waitFor(() => {
        expect(result.current.userName).toBe('Jane Smith');
        expect(result.current.todosCount).toBe(2);
      });
    });

    it('should handle rapid event dispatches correctly', async () => {
      regEvent('increment-counter', ({ draftState }) => {
        draftState.counter = (draftState.counter || 0) + 1;
      });

      regEvent('set-counter', ({ draftState }, value) => {
        draftState.counter = value;
      });

      regSub('counter');

      initState({
        counter: 0,
      });

      const { result } = renderHook(
        () => ({
          counter: useSubscription(['counter']),
        }),
        { wrapper: ReflexTestProvider },
      );

      expect(result.current.counter).toBe(0);

      act(() => {
        dispatch(['increment-counter']);
        dispatch(['increment-counter']);
        dispatch(['increment-counter']);
      });

      await waitForEventAndSubscription();

      await waitFor(() => {
        expect(result.current.counter).toBe(3);
      });

      act(() => {
        dispatch(['set-counter', 10]);
      });

      await waitForEventAndSubscription();

      await waitFor(() => {
        expect(result.current.counter).toBe(10);
      });

      act(() => {
        dispatch(['increment-counter']);
        dispatch(['increment-counter']);
      });

      await waitForEventAndSubscription();

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

      initState({
        todos: [
          { id: 1, text: 'First todo', completed: false },
          { id: 2, text: 'Second todo', completed: true },
        ],
      });

      const { result, rerender } = renderHook(
        ({ id }: { id: number }) => useSubscription<string | null>(['todo-text-by-id', id]),
        { initialProps: { id: 1 }, wrapper: ReflexTestProvider },
      );

      expect(result.current).toBe('First todo');

      // Changing the parameter must switch to the new subscription,
      // not keep returning data for the id captured on first mount
      rerender({ id: 2 });

      expect(result.current).toBe('Second todo');

      // Updates must flow through the re-subscribed subscription
      regEvent('rename-todo-2', ({ draftState }) => {
        draftState.todos[1].text = 'Renamed todo';
      });

      act(() => {
        dispatch(['rename-todo-2']);
      });

      await waitFor(() => {
        expect(result.current).toBe('Renamed todo');
      });
    });

    it('should prune cached subscriptions after the last watcher unsubscribes', () => {
      const { unmount } = renderHook(() => useSubscription(['todos-count']), {
        wrapper: ReflexTestProvider,
      });

      expect(hasCachedSubscription(JSON.stringify(['todos-count']))).toBe(true);
      expect(hasCachedSubscription(JSON.stringify(['todos']))).toBe(true);

      unmount();

      // The computed subscription and its now-unused root dependency diverge:
      // Computed cells are terminal and evicted. The lightweight root source
      // cell stays registered so dormant graphs cannot miss STATE publications.
      expect(hasCachedSubscription(JSON.stringify(['todos-count']))).toBe(false);
      expect(hasCachedSubscription(JSON.stringify(['todos']))).toBe(true);
    });

    it('should keep shared subscriptions cached while another watcher remains', () => {
      const first = renderHook(() => useSubscription(['todos-count']), {
        wrapper: ReflexTestProvider,
      });
      const second = renderHook(() => useSubscription(['todos-count']), {
        wrapper: ReflexTestProvider,
      });

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

      initState({ 'cons-base': 1 });

      regEvent('cons-set-base', ({ draftState }, v: number) => {
        draftState['cons-base'] = v;
      });

      // Capture transient renders as well as the final pair.
      const observed: Array<{ a: number; b: number }> = [];
      const { result } = renderHook(
        () => {
          const a = useSubscription<number>(['cons-x10']);
          const b = useSubscription<number>(['cons-x100']);
          observed.push({ a, b });
          return { a, b };
        },
        { wrapper: ReflexTestProvider },
      );

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

      // No committed render may mix values from different state versions
      for (const { a, b } of observed) {
        expect(b).toBe(a * 10);
      }
    });

    it('should resubscribe correctly after a full unmount/remount cycle', async () => {
      const key = JSON.stringify(['todos-count']);
      const first = renderHook(() => useSubscription<number>(['todos-count']), {
        wrapper: ReflexTestProvider,
      });
      expect(first.result.current).toBe(1);
      first.unmount();
      expect(hasCachedSubscription(key)).toBe(false);

      regEvent('clear-todos', ({ draftState }) => {
        draftState.todos = [];
      });
      act(() => {
        dispatch(['clear-todos']);
      });
      await waitForEventAndSubscription();
      // New subscribers read the last flushed generation, so wait for the
      // animation-frame flush before remounting.
      await waitForAnimationFrame();
      await waitForEventAndSubscription();

      const second = renderHook(() => useSubscription<number>(['todos-count']), {
        wrapper: ReflexTestProvider,
      });
      expect(second.result.current).toBe(0);
      second.unmount();
    });
  });
});
