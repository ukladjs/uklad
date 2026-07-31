/**
 * Roots owned by the `collections` feature.
 *
 * These exist to exercise devtools rendering of Map and Set values. They are
 * four independent roots rather than one nested `collections` object: adding a
 * permission must not change the identity of the roles map. The nested shape
 * the panel renders is rebuilt by the `collections/nested` computed
 * subscription, which is where composition belongs.
 */

export interface CollectionUser {
  id: number;
  name: string;
  role: string;
}

export type CollectionsUsers = Map<string, CollectionUser>;
export type CollectionsPermissions = Set<string>;

/** Role name -> the permissions that role grants. */
export type CollectionsRoles = Map<string, Set<string>>;

/** User name -> the permissions that user currently holds. */
export type CollectionsUserPermissions = Map<string, Set<string>>;

/** The composed value published by `collections/nested`. */
export interface CollectionsNested {
  roles: CollectionsRoles;
  userPermissions: CollectionsUserPermissions;
}

export function createCollectionsUsers(): CollectionsUsers {
  return new Map([
    ['user-1', { id: 1, name: 'Alice', role: 'admin' }],
    ['user-2', { id: 2, name: 'Bob', role: 'user' }],
    ['user-3', { id: 3, name: 'Charlie', role: 'moderator' }],
  ]);
}

export function createCollectionsPermissions(): CollectionsPermissions {
  return new Set(['read', 'write', 'delete']);
}

export function createCollectionsRoles(): CollectionsRoles {
  return new Map([
    ['admin', new Set(['create', 'read', 'update', 'delete'])],
    ['user', new Set(['read', 'update'])],
    ['guest', new Set(['read'])],
  ]);
}

export function createCollectionsUserPermissions(): CollectionsUserPermissions {
  return new Map([
    ['alice', new Set(['read', 'write'])],
    ['bob', new Set(['read'])],
    ['charlie', new Set(['read', 'write', 'delete'])],
  ]);
}
