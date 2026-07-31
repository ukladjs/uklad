import React from 'react';

import { useSubscription } from '../../../app/reflex/bindings';
import { appIds } from '../../../app/reflex/catalog';

interface UserItemProps {
  userId: number;
  onToggle: (id: number) => void;
}

const UserItem: React.FC<UserItemProps> = ({ userId, onToggle }) => {
  // A parameterized subscription: `userId` is checked against the declared
  // params, and `user` is inferred as User | undefined.
  const user = useSubscription([appIds.subscriptions.usersById, userId], 'UserItem');
  if (!user) return null;
  return (
    <div
      className={`user-item ${user.active ? 'active' : 'inactive'}`}
      onClick={() => onToggle(user.id)}
    >
      <span className="user-name">{user.name}</span>
      <span className={`user-status ${user.active ? 'active' : 'inactive'}`}>
        {user.active ? '🟢 Active' : '🔴 Inactive'}
      </span>
    </div>
  );
};

export default UserItem;
