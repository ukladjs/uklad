import { describe, expect, it } from 'vitest';

import type { CoEffects, EventHandler } from '@flexsurfer/reflex';

import type { TodoState } from './state';
import { EVENT_IDS } from './event-ids';
import { todoRuntime } from './runtime';

import './events';

const getEventHandler = (id: string) => todoRuntime.getHandlers().event[id];

// Persistence is handled by @flexsurfer/reflex-persist (see storage.ts), so
// handlers return no storage effects — they only mutate the draft state.

describe('TodoMVC Event Handlers (Pure Functions)', () => {
  describe('ADD_TODO handler', () => {
    it('should add a new todo with correct properties', () => {
      const handler = getEventHandler(EVENT_IDS.ADD_TODO) as EventHandler;
      expect(handler).toBeDefined();

      const mockState: TodoState = {
        todos: new Map(),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.ADD_TODO, 'New Todo'],
        draftState: mockState,
        now: 12345,
      } as CoEffects;

      handler(coeffects, 'New Todo');

      expect(mockState.todos.size).toBe(1);
      expect(mockState.todos.get(12345)).toEqual({
        id: 12345,
        title: 'New Todo',
        done: false,
      });

      expect(Object.keys(mockState)).toEqual(['todos', 'showing']);
      expect(Object.keys(mockState).length).toBe(2);
    });

    it('should trim whitespace from title', () => {
      const handler = getEventHandler(EVENT_IDS.ADD_TODO) as EventHandler;

      const mockState: TodoState = {
        todos: new Map(),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.ADD_TODO, '  Trimmed Todo  '],
        draftState: mockState,
        now: 12345,
      } as CoEffects;

      handler(coeffects, '  Trimmed Todo  ');

      expect(mockState.todos.get(12345)?.title).toBe('Trimmed Todo');
    });
  });

  describe('TOGGLE_DONE handler', () => {
    it('should toggle todo completion status', () => {
      const handler = getEventHandler(EVENT_IDS.TOGGLE_DONE) as EventHandler;

      const mockState: TodoState = {
        todos: new Map([[1, { id: 1, title: 'Test Todo', done: false }]]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.TOGGLE_DONE, 1],
        draftState: mockState,
      } as CoEffects;

      const result = handler(coeffects, 1);

      expect(mockState.todos.get(1)?.done).toBe(true);
      expect(result).toBeUndefined();

      expect(Object.keys(mockState)).toEqual(['todos', 'showing']);
      expect(Object.keys(mockState).length).toBe(2);
    });

    it('should handle non-existent todo gracefully', () => {
      const handler = getEventHandler(EVENT_IDS.TOGGLE_DONE) as EventHandler;

      const mockState: TodoState = {
        todos: new Map(),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.TOGGLE_DONE, 999],
        draftState: mockState,
      } as CoEffects;

      const result = handler(coeffects, 999);

      expect(result).toBeUndefined();
    });
  });

  describe('DELETE_TODO handler', () => {
    it('should remove todo from map', () => {
      const handler = getEventHandler(EVENT_IDS.DELETE_TODO) as EventHandler;

      const mockState: TodoState = {
        todos: new Map([
          [1, { id: 1, title: 'Todo 1', done: false }],
          [2, { id: 2, title: 'Todo 2', done: true }],
        ]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.DELETE_TODO, 1],
        draftState: mockState,
      } as CoEffects;

      const result = handler(coeffects, 1);

      expect(mockState.todos.has(1)).toBe(false);
      expect(mockState.todos.has(2)).toBe(true);
      expect(result).toBeUndefined();

      expect(Object.keys(mockState)).toEqual(['todos', 'showing']);
      expect(Object.keys(mockState).length).toBe(2);
    });
  });

  describe('SAVE handler', () => {
    it('should update todo title with event2 suffix', () => {
      const handler = getEventHandler(EVENT_IDS.SAVE) as EventHandler;

      const mockState: TodoState = {
        todos: new Map([[1, { id: 1, title: 'Original Title', done: false }]]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.SAVE, 1, 'Updated Title'],
        draftState: mockState,
      } as CoEffects;

      const result = handler(coeffects, 1, 'Updated Title');

      expect(mockState.todos.get(1)?.title).toBe('Updated Titleevent2');
      expect(result).toBeUndefined();
    });

    it('should trim whitespace before adding suffix', () => {
      const handler = getEventHandler(EVENT_IDS.SAVE) as EventHandler;

      const mockState: TodoState = {
        todos: new Map([[1, { id: 1, title: 'Original', done: false }]]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.SAVE, 1, '  Spaced Title  '],
        draftState: mockState,
      } as CoEffects;

      handler(coeffects, 1, '  Spaced Title  ');

      expect(mockState.todos.get(1)?.title).toBe('Spaced Titleevent2');
    });
  });

  describe('COMPLETE_ALL_TOGGLE handler', () => {
    it('should mark all as completed when not all are completed', () => {
      const handler = getEventHandler(EVENT_IDS.COMPLETE_ALL_TOGGLE) as EventHandler;

      const mockState: TodoState = {
        todos: new Map([
          [1, { id: 1, title: 'Todo 1', done: false }],
          [2, { id: 2, title: 'Todo 2', done: true }],
          [3, { id: 3, title: 'Todo 3', done: false }],
        ]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.COMPLETE_ALL_TOGGLE],
        draftState: mockState,
      } as CoEffects;

      const result = handler(coeffects);

      expect(mockState.todos.get(1)?.done).toBe(true);
      expect(mockState.todos.get(2)?.done).toBe(true);
      expect(mockState.todos.get(3)?.done).toBe(true);
      expect(result).toBeUndefined();
    });

    it('should mark all as incomplete when all are completed', () => {
      const handler = getEventHandler(EVENT_IDS.COMPLETE_ALL_TOGGLE) as EventHandler;

      const mockState: TodoState = {
        todos: new Map([
          [1, { id: 1, title: 'Todo 1', done: true }],
          [2, { id: 2, title: 'Todo 2', done: true }],
        ]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.COMPLETE_ALL_TOGGLE],
        draftState: mockState,
      } as CoEffects;

      handler(coeffects);

      expect(mockState.todos.get(1)?.done).toBe(false);
      expect(mockState.todos.get(2)?.done).toBe(false);
    });
  });

  describe('CLEAR_COMPLETED handler', () => {
    it('should remove only completed todos', () => {
      const handler = getEventHandler(EVENT_IDS.CLEAR_COMPLETED) as EventHandler;

      const mockState: TodoState = {
        todos: new Map([
          [1, { id: 1, title: 'Todo 1', done: true }],
          [2, { id: 2, title: 'Todo 2', done: false }],
          [3, { id: 3, title: 'Todo 3', done: true }],
        ]),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.CLEAR_COMPLETED],
        draftState: mockState,
      } as CoEffects;

      const result = handler(coeffects);

      expect(mockState.todos.size).toBe(1);
      expect(mockState.todos.has(1)).toBe(false);
      expect(mockState.todos.has(2)).toBe(true);
      expect(mockState.todos.has(3)).toBe(false);
      expect(result).toBeUndefined();
    });
  });

  describe('SET_SHOWING handler', () => {
    it('should update showing filter', () => {
      const handler = getEventHandler(EVENT_IDS.SET_SHOWING) as EventHandler;

      const mockState: TodoState = {
        todos: new Map(),
        showing: 'all',
      };

      const coeffects = {
        event: [EVENT_IDS.SET_SHOWING, 'active'],
        draftState: mockState,
      } as CoEffects;

      const result = handler(coeffects, 'active');

      expect(mockState.showing).toBe('active');
      expect(result).toBeUndefined();

      expect(Object.keys(mockState)).toEqual(['todos', 'showing']);
      expect(Object.keys(mockState).length).toBe(2);
    });

    it('should work with all filter values', () => {
      const handler = getEventHandler(EVENT_IDS.SET_SHOWING) as EventHandler;

      const mockState: TodoState = {
        todos: new Map(),
        showing: 'all',
      };

      handler(
        { event: [EVENT_IDS.SET_SHOWING, 'done'], draftState: mockState } as CoEffects,
        'done',
      );
      expect(mockState.showing).toBe('done');

      handler({ event: [EVENT_IDS.SET_SHOWING, 'all'], draftState: mockState } as CoEffects, 'all');
      expect(mockState.showing).toBe('all');
    });
  });
});
