import { afterEach, describe, expect, it } from 'vitest';

import { appIds } from '../app/uklad/catalog';
import { createTodoHeadlessApp } from '../platform/test/headless';
import type { TodoHeadlessApp } from '../platform/test/headless';

let app: TodoHeadlessApp | undefined;

afterEach(async () => {
  await app?.dispose();
  app = undefined;
});

describe('TodoMVC headless E2E', () => {
  it('drives mounted views through the same events a browser view dispatches', async () => {
    app = createTodoHeadlessApp({ now: 101 });

    const taskList = app.mountView('TaskList', {
      todos: [appIds.subscriptions.todosVisible],
      allComplete: [appIds.subscriptions.todosAllComplete],
    });
    const footer = app.mountView('FooterControls', {
      counts: [appIds.subscriptions.todosFooterCounts],
      showing: [appIds.subscriptions.todosShowing],
    });

    await app.settle();
    expect(taskList.current()).toEqual({ todos: [], allComplete: false });
    expect(footer.current()).toEqual({ counts: [0, 0], showing: 'all' });

    app.dispatch([appIds.events.todosAdd, 'Buy milk']);
    await app.settle();
    app.clock.set(102);
    app.dispatch([appIds.events.todosAdd, 'Write headless E2E']);
    await app.settle();

    expect(taskList.value('todos')).toEqual([
      { id: 101, title: 'Buy milk', done: false },
      { id: 102, title: 'Write headless E2E', done: false },
    ]);
    expect(footer.value('counts')).toEqual([2, 0]);

    app.dispatch([appIds.events.todosToggleDone, 101]);
    await app.settle();
    app.dispatch([appIds.events.todosSetShowing, 'active']);
    await app.settle();

    expect(taskList.value('todos')).toEqual([
      { id: 102, title: 'Write headless E2E', done: false },
    ]);
    expect(footer.current()).toEqual({ counts: [1, 1], showing: 'active' });

    app.dispatch([appIds.events.todosCompleteAllToggle]);
    await app.settle();

    expect(taskList.current()).toEqual({ todos: [], allComplete: true });
    expect(footer.value('counts')).toEqual([0, 2]);

    app.dispatch([appIds.events.todosClearCompleted]);
    await app.settle();

    expect(taskList.current()).toEqual({ todos: [], allComplete: false });
    expect(footer.value('counts')).toEqual([0, 0]);

    const taskListHistory = taskList.history('todos');
    taskList.unmount();
    expect(taskList.mounted).toBe(false);

    app.clock.set(103);
    app.dispatch([appIds.events.todosAdd, 'Only footer is mounted']);
    await app.settle();

    expect(taskList.history('todos')).toEqual(taskListHistory);
    expect(() => taskList.value('todos')).toThrow("Headless view 'TaskList' is unmounted");
    expect(footer.value('counts')).toEqual([1, 0]);

    footer.unmount();
  });
});
