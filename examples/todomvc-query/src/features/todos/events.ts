import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';

/** Pure Todo command handlers: they emit platform-neutral effect intents only. */
export const registerTodosEvents: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registrar.regEvent(appIds.events.todosSetShowing, ({ draftState }, showing) => {
    draftState.todosShowing = showing;
  });
  registrar.regEvent(appIds.events.todosAdd, (_context, title) => [
    [appIds.effects.todosCreate, { title }],
  ]);
  registrar.regEvent(appIds.events.todosToggleDone, (_context, id, done) => [
    [appIds.effects.todosUpdate, { id, done }],
  ]);
  registrar.regEvent(appIds.events.todosDelete, (_context, id) => [
    [appIds.effects.todosDelete, id],
  ]);
  registrar.regEvent(appIds.events.todosSave, (_context, id, title) => [
    [appIds.effects.todosUpdate, { id, title }],
  ]);
  registrar.regEvent(appIds.events.todosCompleteAll, (_context, done) => [
    [appIds.effects.todosCompleteAll, { done }],
  ]);
  registrar.regEvent(
    appIds.events.todosClearCompleted,
    ({ coeffects: { cachedTodos } }) => {
      // The cache is a synchronous hint for a no-op command. A cache miss
      // still reaches the server effect, which remains the authority.
      if (cachedTodos !== undefined && !cachedTodos.some((todo) => todo.done)) return;
      return [[appIds.effects.todosClearCompleted]];
    },
    { coeffects: { cachedTodos: appIds.coeffects.todosCachedList } },
  );
  registrar.regEvent(appIds.events.todosRefresh, () => [[appIds.effects.todosRefresh]]);
};
