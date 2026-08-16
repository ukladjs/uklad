import { enableMapSet } from '@ukladjs/core/vanilla';
import { createUkladHeadlessScenario, type UkladHeadlessScenario } from '@ukladjs/core/testing';
import { memoryStorageAdapter } from '@ukladjs/persist';

import type { AppContracts } from '../../app/uklad/contracts';
import { registerFeatureModules } from '../../app/uklad/register';
import { createAppRuntime } from '../../app/uklad/runtime';
import { registerWebPersistence } from '../web/persistence';
import { createTestClock } from './coeffects';
import type { TestClock } from './coeffects';

export interface CreateTodoHeadlessAppOptions {
  readonly now?: number;
  readonly runtimeId?: string;
}

/** TodoMVC's headless execution owner for browserless E2E scenarios. */
export interface TodoHeadlessApp extends UkladHeadlessScenario<AppContracts> {
  readonly clock: TestClock;
}

/**
 * Build the same TodoMVC state layer the browser uses, with deterministic test
 * platform adapters. Persistence remains installed, but writes to memory
 * rather than `localStorage`.
 */
export function createTodoHeadlessApp(options: CreateTodoHeadlessAppOptions = {}): TodoHeadlessApp {
  enableMapSet();

  const runtime = createAppRuntime({
    runtimeId: options.runtimeId ?? 'todomvc.headless',
    name: 'TodoMVC (Headless)',
  });
  registerFeatureModules(runtime);

  const clock = createTestClock(options.now ?? 1_000);
  runtime.registerModule(clock.module);

  const persistence = registerWebPersistence(runtime, memoryStorageAdapter());
  persistence.hydrate();

  const scenario = createUkladHeadlessScenario(runtime);
  return Object.freeze({
    clock,
    dispatch: scenario.dispatch,
    mountView: scenario.mountView,
    settle: scenario.settle,
    async dispose(): Promise<void> {
      persistence.dispose();
      await scenario.dispose();
    },
  });
}
