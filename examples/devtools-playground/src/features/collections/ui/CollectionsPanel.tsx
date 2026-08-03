import { useRuntime, useSubscription } from '../../../app/uklad/bindings';
import { appIds } from '../../../app/uklad/catalog';

function CollectionsPanel() {
  const runtime = useRuntime();
  const users = useSubscription([appIds.subscriptions.collectionsUsers], 'CollectionsPanel');
  const permissions = useSubscription(
    [appIds.subscriptions.collectionsPermissions],
    'CollectionsPanel',
  );
  // One computed subscription composes the two independent roles roots into
  // the nested shape this panel renders.
  const nested = useSubscription([appIds.subscriptions.collectionsNested], 'CollectionsPanel');

  const addUser = () => {
    runtime.dispatch([
      appIds.events.collectionsAddUser,
      `user-${Date.now()}`,
      {
        id: Date.now(),
        name: `Dynamic User ${Math.floor(Math.random() * 1000)}`,
        role: ['admin', 'user', 'moderator'][Math.floor(Math.random() * 3)]!,
      },
    ]);
  };

  const addPermission = () => {
    const options = ['execute', 'manage', 'share', 'export'];
    runtime.dispatch([
      appIds.events.collectionsAddPermission,
      options[Math.floor(Math.random() * options.length)]!,
    ]);
  };

  const assignRole = () => {
    const roles = ['admin', 'user', 'guest'];
    runtime.dispatch([
      appIds.events.collectionsAssignRole,
      'alice',
      roles[Math.floor(Math.random() * roles.length)]!,
    ]);
  };

  return (
    <div>
      <section className="maps-sets-section">
        <h2>Map &amp; Set Collections</h2>
        <p className="sub-info">
          Subscriptions: <code>{appIds.subscriptions.collectionsUsers}</code>,{' '}
          <code>{appIds.subscriptions.collectionsPermissions}</code>,{' '}
          <code>{appIds.subscriptions.collectionsNested}</code>
        </p>

        <div className="action-buttons" style={{ marginBottom: '1.5rem' }}>
          <button onClick={addUser} className="map-button">
            Add User to Map
          </button>
          <button
            onClick={() =>
              runtime.dispatch([
                appIds.events.collectionsUpdateUser,
                'user-1',
                { role: 'super-admin' },
              ])
            }
            className="map-button"
          >
            Update user-1 Role
          </button>
          <button
            onClick={() => runtime.dispatch([appIds.events.collectionsRemoveUser, 'user-2'])}
            className="map-button"
          >
            Remove user-2
          </button>
          <button onClick={addPermission} className="set-button">
            Add Random Permission
          </button>
          <button
            onClick={() => runtime.dispatch([appIds.events.collectionsRemovePermission, 'read'])}
            className="set-button"
          >
            Remove &quot;read&quot;
          </button>
          <button onClick={assignRole} className="set-button">
            Reassign Alice&apos;s Role
          </button>
        </div>

        <div className="nested-collections-display">
          <div className="collection-item">
            <h3>User Map ({users.size} entries)</h3>
            {Array.from(users.entries()).map(([key, user]) => (
              <div key={key} className="role-item">
                <strong>{key}:</strong> {user.name} — {user.role}
              </div>
            ))}
          </div>

          <div className="collection-item">
            <h3>Permissions Set ({permissions.size} items)</h3>
            <div className="role-item">{Array.from(permissions).join(', ') || '—'}</div>
          </div>

          <div className="collection-item">
            <h3>Roles Map</h3>
            {Array.from(nested.roles.entries()).map(([role, perms]) => (
              <div key={role} className="role-item">
                <strong>{role}:</strong> [{Array.from(perms).join(', ')}]
              </div>
            ))}
          </div>

          <div className="collection-item">
            <h3>User Permissions</h3>
            {Array.from(nested.userPermissions.entries()).map(([user, perms]) => (
              <div key={user} className="user-item">
                <strong>{user}:</strong> [{Array.from(perms).join(', ')}]
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default CollectionsPanel;
