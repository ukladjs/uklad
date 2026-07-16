import React from 'react';
import ReactDOM from 'react-dom/client';
import { createReflexInspector, enableMapSet } from '@flexsurfer/reflex';
import { enableDevtools } from '@flexsurfer/reflex-devtools';
import './index.css';
import './db';
import './events';
import './subs';
import './effects.browser';
import './coeffects.browser';
import App from './App';

enableDevtools(createReflexInspector());
enableMapSet();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
