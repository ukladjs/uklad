import { useState } from 'react';
import './App.css';
import CounterPanel from './components/CounterPanel';
import UsersPanel from './components/UsersPanel';
import CollectionsPanel from './components/CollectionsPanel';

type TabId = 'counter' | 'users' | 'collections';

const TABS: { id: TabId; label: string; subs: string }[] = [
  { id: 'counter',     label: 'Counter & Actions',  subs: 'counter, isLoading' },
  { id: 'users',       label: 'Users',               subs: 'users, isLoading, user-by-id' },
  { id: 'collections', label: 'Collections',         subs: 'userMap, permissionsSet, nestedCollections-comp' },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('counter');

  return (
    <div className="app">
      <header className="app-header">
        <h1>🚀 Reflex Devtools Example</h1>
        <p>
          Switch panels below — each panel mounts/unmounts with its own subscriptions.
          Open{' '}
          <a href="http://localhost:4000" target="_blank" rel="noopener noreferrer">
            http://localhost:4000
          </a>{' '}
          to watch active subscriptions change in the devtools dashboard.
        </p>
      </header>

      <main className="app-main">
        <nav className="tab-nav">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`tab-button${activeTab === tab.id ? ' tab-button--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab-label">{tab.label}</span>
              <span className="tab-subs">{tab.subs}</span>
            </button>
          ))}
        </nav>

        <div className="tab-content">
          {activeTab === 'counter'     && <CounterPanel />}
          {activeTab === 'users'       && <UsersPanel />}
          {activeTab === 'collections' && <CollectionsPanel />}
        </div>
      </main>
    </div>
  );
}

export default App;
