import ReactDOM from 'react-dom/client';
import { dispatch } from '@flexsurfer/reflex';
import App from './App';
import './index.css';
import './db';
import './subs';
import './events';
import './effects';

dispatch(['init-socket']);

ReactDOM.createRoot(document.getElementById('root')!).render(
    <App />
); 