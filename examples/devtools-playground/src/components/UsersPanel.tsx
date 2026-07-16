import { useCallback } from 'react';
import { dispatch, useSubscription } from '@flexsurfer/reflex';
import UserItem from './UserItem';

function UsersPanel() {
  const users = useSubscription<any[]>(['users'], 'UsersPanel');
  const isLoading = useSubscription<boolean>(['isLoading'], 'UsersPanel');

  const handleUserToggle = useCallback((userId: number) => {
    dispatch(['toggle-user', userId]);
  }, []);

  const addUser = async () => {
    dispatch(['set-loading', true]);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      dispatch(['add-user', {
        id: (users?.length ?? 0) + 1,
        name: `User ${(users?.length ?? 0) + 1}`,
        active: Math.random() > 0.5,
      }]);
    } finally {
      dispatch(['set-loading', false]);
    }
  };

  return (
    <div>
      <section className="users-section">
        <h2>User List</h2>
        <p className="sub-info">Subscriptions: <code>users</code>, <code>isLoading</code>, <code>user-by-id</code> (per item)</p>
        <div className="action-buttons" style={{ marginBottom: '1rem' }}>
          <button onClick={addUser} disabled={!!isLoading} className="api-button">
            {isLoading ? 'Adding...' : 'Add User'}
          </button>
        </div>
        <div className="users-list">
          {users?.map((user: any) => (
            <UserItem key={user.id} userId={user.id} onToggle={handleUserToggle} />
          )) ?? []}
        </div>
      </section>
    </div>
  );
}

export default UsersPanel;
