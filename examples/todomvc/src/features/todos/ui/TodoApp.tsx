import React from 'react';

import { FooterControls } from './FooterControls';
import { TaskEntry } from './TaskEntry';
import { TaskList } from './TaskList';

export const TodoApp: React.FC = () => {
  return (
    <>
      <section id="todoapp">
        <TaskEntry />
        <TaskList />
        <FooterControls />
      </section>
      <footer id="info">
        <p>Double-click to edit a todo</p>
      </footer>
    </>
  );
};
