import { describe, expect, it } from 'vitest';

import type { SubDepsHandler, SubHandler } from '@flexsurfer/reflex';
import { createReflexTestHarness } from '@flexsurfer/reflex/testing';

import type { TodoState } from './state';
import { SUB_IDS } from './sub-ids';
import { todoRuntime } from './runtime';

import './subs';

const testHarness = createReflexTestHarness(todoRuntime);
const initState = (state: TodoState) => testHarness.restoreState(state);

describe('TodoMVC Subscription Handlers (Pure Functions)', () => {
  describe('Root Subscriptions', () => {
    describe('TODOS subscription', () => {
      it('should return todos from state', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.TODOS) as SubHandler;
        expect(handler).toBeDefined();

        const mockState: TodoState = {
          todos: new Map([
            [1, { id: 1, title: 'Todo 1', done: false }],
            [2, { id: 2, title: 'Todo 2', done: true }],
          ]),
          showing: 'all',
        };

        initState(mockState);

        const result = handler();

        expect(result).toBe(mockState.todos);
        expect(result.size).toBe(2);
        expect(result.get(1)).toEqual({ id: 1, title: 'Todo 1', done: false });
        expect(result.get(2)).toEqual({ id: 2, title: 'Todo 2', done: true });
      });

      it('should handle empty todos map', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.TODOS) as SubHandler;

        const mockState: TodoState = {
          todos: new Map(),
          showing: 'all',
        };

        initState(mockState);

        const result = handler();

        expect(result).toBe(mockState.todos);
        expect(result.size).toBe(0);
      });
    });

    describe('SHOWING subscription', () => {
      it('should return showing filter from state', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.SHOWING) as SubHandler;
        expect(handler).toBeDefined();

        const mockState: TodoState = {
          todos: new Map(),
          showing: 'active',
        };

        initState(mockState);

        const result = handler();

        expect(result).toBe('active');
      });

      it('should handle all showing states', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.SHOWING) as SubHandler;

        const testCases = ['all', 'active', 'done'] as const;

        testCases.forEach((showingState) => {
          const mockState: TodoState = {
            todos: new Map(),
            showing: showingState,
          };

          initState(mockState);

          const result = handler();
          expect(result).toBe(showingState);
        });
      });
    });
  });

  describe('Computed Subscriptions', () => {
    describe('VISIBLE_TODOS subscription', () => {
      it('should return all todos when showing is all', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.VISIBLE_TODOS) as SubHandler;
        expect(handler).toBeDefined();

        const todos = new Map([
          [1, { id: 1, title: 'Todo 1', done: false }],
          [2, { id: 2, title: 'Todo 2', done: true }],
          [3, { id: 3, title: 'Todo 3', done: false }],
        ]);

        const result = handler(todos, 'all');

        expect(result).toHaveLength(3);
        expect(result).toEqual([
          { id: 1, title: 'Todo 1', done: false },
          { id: 2, title: 'Todo 2', done: true },
          { id: 3, title: 'Todo 3', done: false },
        ]);
      });

      it('should return only active todos when showing is active', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.VISIBLE_TODOS) as SubHandler;

        const todos = new Map([
          [1, { id: 1, title: 'Todo 1', done: false }],
          [2, { id: 2, title: 'Todo 2', done: true }],
          [3, { id: 3, title: 'Todo 3', done: false }],
        ]);

        const result = handler(todos, 'active');

        expect(result).toHaveLength(2);
        expect(result).toEqual([
          { id: 1, title: 'Todo 1', done: false },
          { id: 3, title: 'Todo 3', done: false },
        ]);
      });

      it('should return only done todos when showing is done', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.VISIBLE_TODOS) as SubHandler;

        const todos = new Map([
          [1, { id: 1, title: 'Todo 1', done: false }],
          [2, { id: 2, title: 'Todo 2', done: true }],
          [3, { id: 3, title: 'Todo 3', done: true }],
        ]);

        const result = handler(todos, 'done');

        expect(result).toHaveLength(2);
        expect(result).toEqual([
          { id: 2, title: 'Todo 2', done: true },
          { id: 3, title: 'Todo 3', done: true },
        ]);
      });

      it('should return empty array when todos is null or undefined', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.VISIBLE_TODOS) as SubHandler;

        expect(handler(null, 'all')).toEqual([]);
        expect(handler(undefined, 'all')).toEqual([]);
      });

      it('should return empty array when todos is empty', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.VISIBLE_TODOS) as SubHandler;

        const result = handler(new Map(), 'all');
        expect(result).toEqual([]);
      });
    });

    describe('ALL_COMPLETE subscription', () => {
      it('should return true when all todos are complete', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.ALL_COMPLETE) as SubHandler;
        expect(handler).toBeDefined();

        const todos = new Map([
          [1, { id: 1, title: 'Todo 1', done: true }],
          [2, { id: 2, title: 'Todo 2', done: true }],
          [3, { id: 3, title: 'Todo 3', done: true }],
        ]);

        const result = handler(todos);
        expect(result).toBe(true);
      });

      it('should return false when some todos are incomplete', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.ALL_COMPLETE) as SubHandler;

        const todos = new Map([
          [1, { id: 1, title: 'Todo 1', done: true }],
          [2, { id: 2, title: 'Todo 2', done: false }],
          [3, { id: 3, title: 'Todo 3', done: true }],
        ]);

        const result = handler(todos);
        expect(result).toBe(false);
      });

      it('should return false when all todos are incomplete', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.ALL_COMPLETE) as SubHandler;

        const todos = new Map([
          [1, { id: 1, title: 'Todo 1', done: false }],
          [2, { id: 2, title: 'Todo 2', done: false }],
        ]);

        const result = handler(todos);
        expect(result).toBe(false);
      });

      it('should return false when todos is empty', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.ALL_COMPLETE) as SubHandler;

        const result = handler(new Map());
        expect(result).toBe(false);
      });

      it('should return true when there is only one complete todo', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.ALL_COMPLETE) as SubHandler;

        const todos = new Map([[1, { id: 1, title: 'Single Todo', done: true }]]);

        const result = handler(todos);
        expect(result).toBe(true);
      });

      it('should return false when there is only one incomplete todo', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.ALL_COMPLETE) as SubHandler;

        const todos = new Map([[1, { id: 1, title: 'Single Todo', done: false }]]);

        const result = handler(todos);
        expect(result).toBe(false);
      });

      it('should have correct dependencies', () => {
        const depsHandler = testHarness.getSubscriptionDependencies(
          SUB_IDS.ALL_COMPLETE,
        ) as SubDepsHandler;
        expect(depsHandler).toBeDefined();

        const deps = depsHandler();
        expect(deps).toEqual([[SUB_IDS.TODOS]]);
      });
    });

    describe('FOOTER_COUNTS subscription', () => {
      it('should return correct counts for mixed todos', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.FOOTER_COUNTS) as SubHandler;
        expect(handler).toBeDefined();

        const todos = new Map([
          [1, { id: 1, title: 'Todo 1', done: false }],
          [2, { id: 2, title: 'Todo 2', done: true }],
          [3, { id: 3, title: 'Todo 3', done: false }],
          [4, { id: 4, title: 'Todo 4', done: true }],
          [5, { id: 5, title: 'Todo 5', done: false }],
        ]);

        const result = handler(todos);
        expect(result).toEqual([3, 2]); // [active, done]
      });

      it('should return correct counts when all todos are active', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.FOOTER_COUNTS) as SubHandler;

        const todos = new Map([
          [1, { id: 1, title: 'Todo 1', done: false }],
          [2, { id: 2, title: 'Todo 2', done: false }],
          [3, { id: 3, title: 'Todo 3', done: false }],
        ]);

        const result = handler(todos);
        expect(result).toEqual([3, 0]); // [active, done]
      });

      it('should return correct counts when all todos are done', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.FOOTER_COUNTS) as SubHandler;

        const todos = new Map([
          [1, { id: 1, title: 'Todo 1', done: true }],
          [2, { id: 2, title: 'Todo 2', done: true }],
        ]);

        const result = handler(todos);
        expect(result).toEqual([0, 2]); // [active, done]
      });

      it('should return zero counts when todos is empty', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.FOOTER_COUNTS) as SubHandler;

        const result = handler(new Map());
        expect(result).toEqual([0, 0]); // [active, done]
      });

      it('should handle single todo correctly', () => {
        const handler = testHarness.getSubscriptionHandler(SUB_IDS.FOOTER_COUNTS) as SubHandler;

        const activeTodos = new Map([[1, { id: 1, title: 'Single Active', done: false }]]);

        const doneTodos = new Map([[1, { id: 1, title: 'Single Done', done: true }]]);

        expect(handler(activeTodos)).toEqual([1, 0]);
        expect(handler(doneTodos)).toEqual([0, 1]);
      });

      it('should have correct dependencies', () => {
        const depsHandler = testHarness.getSubscriptionDependencies(
          SUB_IDS.FOOTER_COUNTS,
        ) as SubDepsHandler;
        expect(depsHandler).toBeDefined();

        const deps = depsHandler();
        expect(deps).toEqual([[SUB_IDS.TODOS]]);
      });
    });
  });
});
