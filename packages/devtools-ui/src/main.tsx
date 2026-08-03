import ReactDOM from 'react-dom/client';
import { UkladProvider } from '@ukladjs/core';
import App from './App';
import './index.css';
import './subs';
import './events';
import './effects';
import { devtoolsRuntime, dispatch } from './runtime';

dispatch(['init-socket']);

ReactDOM.createRoot(document.getElementById('root')!).render(
    <UkladProvider runtime={devtoolsRuntime}>
        <App />
    </UkladProvider>
);
