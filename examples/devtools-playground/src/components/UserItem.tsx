import React from 'react';
import { useSubscription } from '@flexsurfer/reflex';

interface User {
  id: number;
  name: string;
  active: boolean;
}

interface UserItemProps {
  userId: number;
  onToggle: (id: number) => void;
}

const UserItem: React.FC<UserItemProps> = ({ userId, onToggle }) => {
  const user = useSubscription<User>(['user-by-id', userId], 'UserItem');
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