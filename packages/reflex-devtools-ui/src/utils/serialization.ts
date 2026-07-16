/**
 * Reviver function for JSON.parse to deserialize Maps and Sets
 */
export function reflexReviver(_key: string, value: any): any {
  // Handle serialized Maps
  if (value && typeof value === 'object' && value.__reflex_type === 'Map') {
    return new Map(value.entries);
  }
  // Handle serialized Sets
  if (value && typeof value === 'object' && value.__reflex_type === 'Set') {
    return new Set(value.values);
  }
  // For all other values, return as-is
  return value;
}