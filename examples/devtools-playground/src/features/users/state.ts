/** Roots owned by the `users` feature. */

export interface User {
  id: number;
  name: string;
  active: boolean;
}

export type UsersList = User[];

/** Separate from `usersList` on purpose: a spinner must not invalidate the list. */
export type UsersLoading = boolean;

export function createUsersList(): UsersList {
  return [
    { id: 1, name: 'John Doe', active: true },
    { id: 2, name: 'Jane Smith', active: false },
    { id: 3, name: 'Bob Johnson', active: true },
  ];
}

export function createUsersLoading(): UsersLoading {
  return false;
}
