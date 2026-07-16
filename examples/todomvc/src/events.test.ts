import { describe, expect, it } from 'vitest';

import { getHandler, type CoEffects, type EventHandler } from '@flexsurfer/reflex';

import type { Todo, TodoDb, TodoId } from './db';
import { EFFECT_IDS } from './effect-ids';
import { EVENT_IDS } from './event-ids';

import './events';

describe('TodoMVC Event Handlers (Pure Functions)', () => {
  describe('INIT_APP handler', () => {
    it('should initialize with todos from localStorage', () => {
      const handler = getHandler('event', EVENT_IDS.INIT_APP) as EventHandler;
      expect(handler).toBeDefined();

      const mockDb: TodoDb = {
        todos: new Map(),
        showing: 'all',
      };

      const existingTodos = new Map<TodoId, Todo>();
      existingTodos.set(1, { id: 1, title: 'Test Todo', done: false });

      const coeffects = {
        event: [EVENT_IDS.INIT_APP],
        draftDb: mockDb,
        localStoreTodos: existingTodos,
      } as CoEffects;

      handler(coeffects);

      expect(mockDb.showing).toBe('all');
      expect(mockDb.todos.size).toBe(1);
      expect(mockDb.todos.get(1)).toEqual({ id: 1, title: 'Test Todo', done: false });

      expect(Object.keys(mockDb)).toEqual(['todos', 'showing']);
      expect(Object.keys(mockDb).length).toBe(2);
    });

    it('should not modify db when localStorage is empty', () => {
      const handler = getHandler('event', EVENT_IDS.INIT_APP) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map(),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.INIT_APP],
        draftDb: mockDb,
        localStoreTodos: new Map(),
      } as CoEffects;

      handler(coeffects);

      expect(mockDb.todos.size).toBe(0);
      expect(mockDb.showing).toBe('all');

      expect(Object.keys(mockDb)).toEqual(['todos', 'showing']);
      expect(Object.keys(mockDb).length).toBe(2);
    });
  });

  describe('ADD_TODO handler', () => {
    it('should add a new todo with correct properties', () => {
      const handler = getHandler('event', EVENT_IDS.ADD_TODO) as EventHandler;
      expect(handler).toBeDefined();

      const mockDb: TodoDb = {
        todos: new Map(),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.ADD_TODO, 'New Todo'],
        draftDb: mockDb,
        now: 12345,
      } as CoEffects;

      handler(coeffects, 'New Todo');

      expect(mockDb.todos.size).toBe(1);
      expect(mockDb.todos.get(12345)).toEqual({
        id: 12345,
        title: 'New Todo',
        done: false,
      });

      expect(Object.keys(mockDb)).toEqual(['todos', 'showing']);
      expect(Object.keys(mockDb).length).toBe(2);
    });

    it('should trim whitespace from title', () => {
      const handler = getHandler('event', EVENT_IDS.ADD_TODO) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map(),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.ADD_TODO, '  Trimmed Todo  '],
        draftDb: mockDb,
        now: 12345,
      } as CoEffects;

      handler(coeffects, '  Trimmed Todo  ');

      expect(mockDb.todos.get(12345)?.title).toBe('Trimmed Todo');
    });
  });

  describe('TOGGLE_DONE handler', () => {
    it('should toggle todo completion status', () => {
      const handler = getHandler('event', EVENT_IDS.TOGGLE_DONE) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map([[1, { id: 1, title: 'Test Todo', done: false }]]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.TOGGLE_DONE, 1],
        draftDb: mockDb,
      } as CoEffects;

      const result = handler(coeffects, 1);

      expect(mockDb.todos.get(1)?.done).toBe(true);
      expect(result).toEqual([[EFFECT_IDS.TODOS_TO_LOCAL_STORE, mockDb.todos]]);

      expect(Object.keys(mockDb)).toEqual(['todos', 'showing']);
      expect(Object.keys(mockDb).length).toBe(2);
    });

    it('should handle non-existent todo gracefully', () => {
      const handler = getHandler('event', EVENT_IDS.TOGGLE_DONE) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map(),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.TOGGLE_DONE, 999],
        draftDb: mockDb,
      } as CoEffects;

      const result = handler(coeffects, 999);

      expect(result).toBeUndefined();
    });
  });

  describe('DELETE_TODO handler', () => {
    it('should remove todo from map', () => {
      const handler = getHandler('event', EVENT_IDS.DELETE_TODO) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map([
          [1, { id: 1, title: 'Todo 1', done: false }],
          [2, { id: 2, title: 'Todo 2', done: true }],
        ]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.DELETE_TODO, 1],
        draftDb: mockDb,
      } as CoEffects;

      const result = handler(coeffects, 1);

      expect(mockDb.todos.has(1)).toBe(false);
      expect(mockDb.todos.has(2)).toBe(true);
      expect(result).toEqual([[EFFECT_IDS.TODOS_TO_LOCAL_STORE, mockDb.todos]]);

      expect(Object.keys(mockDb)).toEqual(['todos', 'showing']);
      expect(Object.keys(mockDb).length).toBe(2);
    });
  });

  describe('SAVE handler', () => {
    it('should update todo title with event2 suffix', () => {
      const handler = getHandler('event', EVENT_IDS.SAVE) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map([[1, { id: 1, title: 'Original Title', done: false }]]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.SAVE, 1, 'Updated Title'],
        draftDb: mockDb,
      } as CoEffects;

      const result = handler(coeffects, 1, 'Updated Title');

      expect(mockDb.todos.get(1)?.title).toBe('Updated Titleevent2');
      expect(result).toEqual([[EFFECT_IDS.TODOS_TO_LOCAL_STORE, mockDb.todos]]);
    });

    it('should trim whitespace before adding suffix', () => {
      const handler = getHandler('event', EVENT_IDS.SAVE) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map([[1, { id: 1, title: 'Original', done: false }]]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.SAVE, 1, '  Spaced Title  '],
        draftDb: mockDb,
      } as CoEffects;

      handler(coeffects, 1, '  Spaced Title  ');

      expect(mockDb.todos.get(1)?.title).toBe('Spaced Titleevent2');
    });
  });

  describe('COMPLETE_ALL_TOGGLE handler', () => {
    it('should mark all as completed when not all are completed', () => {
      const handler = getHandler('event', EVENT_IDS.COMPLETE_ALL_TOGGLE) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map([
          [1, { id: 1, title: 'Todo 1', done: false }],
          [2, { id: 2, title: 'Todo 2', done: true }],
          [3, { id: 3, title: 'Todo 3', done: false }],
        ]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.COMPLETE_ALL_TOGGLE],
        draftDb: mockDb,
      } as CoEffects;

      const result = handler(coeffects);

      expect(mockDb.todos.get(1)?.done).toBe(true);
      expect(mockDb.todos.get(2)?.done).toBe(true);
      expect(mockDb.todos.get(3)?.done).toBe(true);
      expect(result).toEqual([[EFFECT_IDS.TODOS_TO_LOCAL_STORE, mockDb.todos]]);
    });

    it('should mark all as incomplete when all are completed', () => {
      const handler = getHandler('event', EVENT_IDS.COMPLETE_ALL_TOGGLE) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map([
          [1, { id: 1, title: 'Todo 1', done: true }],
          [2, { id: 2, title: 'Todo 2', done: true }],
        ]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.COMPLETE_ALL_TOGGLE],
        draftDb: mockDb,
      } as CoEffects;

      handler(coeffects);

      expect(mockDb.todos.get(1)?.done).toBe(false);
      expect(mockDb.todos.get(2)?.done).toBe(false);
    });
  });

  describe('CLEAR_COMPLETED handler', () => {
    it('should remove only completed todos', () => {
      const handler = getHandler('event', EVENT_IDS.CLEAR_COMPLETED) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map([
          [1, { id: 1, title: 'Todo 1', done: true }],
          [2, { id: 2, title: 'Todo 2', done: false }],
          [3, { id: 3, title: 'Todo 3', done: true }],
        ]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.CLEAR_COMPLETED],
        draftDb: mockDb,
      } as CoEffects;

      const result = handler(coeffects);

      expect(mockDb.todos.size).toBe(1);
      expect(mockDb.todos.has(1)).toBe(false);
      expect(mockDb.todos.has(2)).toBe(true);
      expect(mockDb.todos.has(3)).toBe(false);
      expect(result).toEqual([[EFFECT_IDS.TODOS_TO_LOCAL_STORE, mockDb.todos]]);
    });
  });

  describe('SET_SHOWING handler', () => {
    it('should update showing filter', () => {
      const handler = getHandler('event', EVENT_IDS.SET_SHOWING) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map(),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.SET_SHOWING, 'active'],
        draftDb: mockDb,
      } as CoEffects;

      const result = handler(coeffects, 'active');

      expect(mockDb.showing).toBe('active');
      expect(result).toBeUndefined();

      expect(Object.keys(mockDb)).toEqual(['todos', 'showing']);
      expect(Object.keys(mockDb).length).toBe(2);
    });

    it('should work with all filter values', () => {
      const handler = getHandler('event', EVENT_IDS.SET_SHOWING) as EventHandler;

      const mockDb: TodoDb = {
        todos: new Map(),
        showing: 'all',
      };

      handler({ event: [EVENT_IDS.SET_SHOWING, 'done'], draftDb: mockDb } as CoEffects, 'done');
      expect(mockDb.showing).toBe('done');

      handler({ event: [EVENT_IDS.SET_SHOWING, 'all'], draftDb: mockDb } as CoEffects, 'all');
      expect(mockDb.showing).toBe('all');
    });
  });
});
