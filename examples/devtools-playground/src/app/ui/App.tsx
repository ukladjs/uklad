import { useState } from 'react';

import { appIds } from '../uklad/catalog';
import CollectionsPanel from '../../features/collections/ui/CollectionsPanel';
import CounterPanel from '../../features/counter/ui/CounterPanel';
import DiagnosticsPanel from '../../features/diagnostics/ui/DiagnosticsPanel';
import UsersPanel from '../../features/users/ui/UsersPanel';
import './App.css';

type TabId = 'counter' | 'users' | 'collections' | 'diagnostics';

/**
 * The application shell. It owns no state roots and no registrations — it only
 * mounts one feature-owned panel at a time, which is what makes the devtools
 * dashboard show active subscriptions appearing and disappearing.
 */
const TABS: { id: TabId; label: string; subs: string }[] = [
  {
    id: 'counter',
    label: 'Counter',
    subs: [appIds.subscriptions.counterValue, appIds.subscriptions.counterEffectDispatches].join(
      ', ',
    ),
  },
  {
    id: 'users',
    label: 'Users',
    subs: [
      appIds.subscriptions.usersList,
      appIds.subscriptions.usersLoading,
      appIds.subscriptions.usersById,
    ].join(', '),
  },
  {
    id: 'collections',
    label: 'Collections',
    subs: [
      appIds.subscriptions.collectionsUsers,
      appIds.subscriptions.collectionsPermissions,
      appIds.subscriptions.collectionsNested,
    ].join(', '),
  },
  { id: 'diagnostics', label: 'Diagnostics', subs: 'none' },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('counter');

  return (
    <div className="app">
      <header className="app-header">
        <h1>🚀 Uklad Devtools Example</h1>
        <p>
          Switch panels below — each panel mounts/unmounts with its own subscriptions. Open{' '}
          <a href="http://localhost:4000" target="_blank" rel="noopener noreferrer">
            http://localhost:4000
          </a>{' '}
          to watch active subscriptions change in the devtools dashboard.
        </p>
      </header>

      <main className="app-main">
        <nav className="tab-nav">
          {TABS.map((tab) => (
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
          {activeTab === 'counter' && <CounterPanel />}
          {activeTab === 'users' && <UsersPanel />}
          {activeTab === 'collections' && <CollectionsPanel />}
          {activeTab === 'diagnostics' && <DiagnosticsPanel />}
        </div>
      </main>
    </div>
  );
}

export default App;
