import React from 'react';

import { appIds } from '../../../app/reflex/catalog';
import { useRuntime, useSubscription } from '../../../app/reflex/bindings';
import type { TodosShowing } from '../state';

export const FooterControls: React.FC = () => {
  const runtime = useRuntime();
  const [active, done] = useSubscription(
    [appIds.subscriptions.todosFooterCounts],
    'FooterControls',
  );
  const showing = useSubscription([appIds.subscriptions.todosShowing], 'FooterControls');

  const filterLink = (filterKw: TodosShowing, text: string) => (
    <a
      className={showing === filterKw ? 'selected' : ''}
      href={`#/${filterKw}`}
      onClick={(e) => {
        e.preventDefault();
        runtime.dispatch([appIds.events.todosSetShowing, filterKw]);
      }}
    >
      {text}
    </a>
  );

  return (
    <footer id="footer">
      <span id="todo-count">
        <strong>{active}</strong> {active === 1 ? 'item' : 'items'} left
      </span>
      <ul id="filters">
        <li>{filterLink('all', 'All')}</li>
        <li>{filterLink('active', 'Active')}</li>
        <li>{filterLink('done', 'Completed')}</li>
      </ul>
      {done > 0 && (
        <button
          id="clear-completed"
          onClick={() => runtime.dispatch([appIds.events.todosClearCompleted])}
        >
          Clear completed
        </button>
      )}
    </footer>
  );
};
