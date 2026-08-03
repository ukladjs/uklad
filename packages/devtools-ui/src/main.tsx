import ReactDOM from 'react-dom/client';
import { ReflexProvider } from '@flexsurfer/reflex';
import App from './App';
import './index.css';
import './subs';
import './events';
import './effects';
import { devtoolsRuntime, dispatch } from './runtime';

dispatch(['init-socket']);

ReactDOM.createRoot(document.getElementById('root')!).render(
    <ReflexProvider runtime={devtoolsRuntime}>
        <App />
    </ReflexProvider>
);
