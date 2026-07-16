import { dispatch, useSubscription } from '@flexsurfer/reflex';

function CollectionsPanel() {
  const userMap = useSubscription<Map<string, any>>(['userMap'], 'CollectionsPanel');
  const permissionsSet = useSubscription<Set<string>>(['permissionsSet'], 'CollectionsPanel');
  const nestedCollections = useSubscription<any>(['nestedCollections-comp'], 'CollectionsPanel');

  const addUserToMap = () => {
    const userId = `user-${Date.now()}`;
    dispatch(['add-user-to-map', userId, {
      id: Date.now(),
      name: `Dynamic User ${Math.floor(Math.random() * 1000)}`,
      role: ['admin', 'user', 'moderator'][Math.floor(Math.random() * 3)],
    }]);
  };

  const addPermission = () => {
    const options = ['execute', 'manage', 'share', 'export'];
    dispatch(['add-permission', options[Math.floor(Math.random() * options.length)]]);
  };

  const toggleUserRole = () => {
    const roles = ['admin', 'user', 'guest'];
    dispatch(['toggle-user-role', 'alice', roles[Math.floor(Math.random() * roles.length)]]);
  };

  const createComplexStructure = () => dispatch(['create-complex-map-set-structure']);

  return (
    <div>
      <section className="maps-sets-section">
        <h2>Map & Set Collections</h2>
        <p className="sub-info">Subscriptions: <code>userMap</code>, <code>permissionsSet</code>, <code>nestedCollections-comp</code></p>

        <div className="action-buttons" style={{ marginBottom: '1.5rem' }}>
          <button onClick={addUserToMap} className="map-button">Add User to Map</button>
          <button onClick={() => dispatch(['update-user-in-map', 'user-1', { role: 'super-admin' }])} className="map-button">Update user-1 Role</button>
          <button onClick={() => dispatch(['remove-user-from-map', 'user-2'])} className="map-button">Remove user-2</button>
          <button onClick={addPermission} className="set-button">Add Random Permission</button>
          <button onClick={() => dispatch(['remove-permission', 'read'])} className="set-button">Remove "read"</button>
          <button onClick={toggleUserRole} className="set-button">Toggle Alice's Role</button>
          <button onClick={createComplexStructure} className="complex-button">Create Complex Structure</button>
        </div>

        <div className="nested-collections-display">
          <div className="collection-item">
            <h3>User Map ({userMap?.size ?? 0} entries)</h3>
            {userMap && Array.from(userMap.entries()).map(([key, val]) => (
              <div key={key} className="role-item">
                <strong>{key}:</strong> {val.name} — {val.role}
              </div>
            ))}
          </div>

          <div className="collection-item">
            <h3>Permissions Set ({permissionsSet?.size ?? 0} items)</h3>
            <div className="role-item">
              {permissionsSet ? Array.from(permissionsSet).join(', ') : '—'}
            </div>
          </div>

          <div className="collection-item">
            <h3>Roles Map</h3>
            {nestedCollections?.rolesMap &&
              (Array.from(nestedCollections.rolesMap.entries()) as [string, Set<string>][]).map(([role, perms]) => (
                <div key={role} className="role-item">
                  <strong>{role}:</strong> [{Array.from(perms).join(', ')}]
                </div>
              ))}
          </div>

          <div className="collection-item">
            <h3>User Permissions</h3>
            {nestedCollections?.userPermissions &&
              (Array.from(nestedCollections.userPermissions.entries()) as [string, Set<string>][]).map(([user, perms]) => (
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
