import { useCallback } from 'react';

import { useRuntime, useSubscription } from '../../../app/uklad/bindings';
import { appIds } from '../../../app/uklad/catalog';
import UserItem from './UserItem';

function UsersPanel() {
  const runtime = useRuntime();
  const users = useSubscription([appIds.subscriptions.usersList], 'UsersPanel');
  const isLoading = useSubscription([appIds.subscriptions.usersLoading], 'UsersPanel');

  const handleUserToggle = useCallback(
    (userId: number) => {
      runtime.dispatch([appIds.events.usersToggle, userId]);
    },
    [runtime],
  );

  const addUser = async () => {
    runtime.dispatch([appIds.events.usersSetLoading, true]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runtime.dispatch([
        appIds.events.usersAdd,
        {
          id: users.length + 1,
          name: `User ${users.length + 1}`,
          active: Math.random() > 0.5,
        },
      ]);
    } finally {
      runtime.dispatch([appIds.events.usersSetLoading, false]);
    }
  };

  return (
    <div>
      <section className="users-section">
        <h2>User List</h2>
        <p className="sub-info">
          Subscriptions: <code>{appIds.subscriptions.usersList}</code>,{' '}
          <code>{appIds.subscriptions.usersLoading}</code>,{' '}
          <code>{appIds.subscriptions.usersById}</code> (per item)
        </p>
        <div className="action-buttons" style={{ marginBottom: '1rem' }}>
          <button onClick={addUser} disabled={isLoading} className="api-button">
            {isLoading ? 'Adding...' : 'Add User'}
          </button>
        </div>
        <div className="users-list">
          {users.map((user) => (
            <UserItem key={user.id} userId={user.id} onToggle={handleUserToggle} />
          ))}
        </div>
      </section>
    </div>
  );
}

export default UsersPanel;
