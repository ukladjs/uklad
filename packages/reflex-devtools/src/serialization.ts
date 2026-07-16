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

/**
 * Replacer function for JSON.stringify to serialize Maps and Sets
 */
export function reflexReplacer(_key: string, value: any): any {
  // Handle primitive types that are serializable
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }

  // Handle undefined
  if (value === undefined) {
    return 'undefined';
  }

  // Handle functions
  if (typeof value === 'function') {
    return '[Function]';
  }

  // Handle symbols
  if (typeof value === 'symbol') {
    return '[Symbol]';
  }

  // Handle BigInt
  if (typeof value === 'bigint') {
    return `[BigInt: ${value.toString()}]`;
  }

  // Handle objects
  if (typeof value === 'object') {

    // Handle Maps
    if (value instanceof Map) {
      return {
        __reflex_type: 'Map',
        entries: Array.from(value.entries())
      };
    }
    // Handle Sets
    if (value instanceof Set) {
      return {
        __reflex_type: 'Set',
        values: Array.from(value)
      };
    }
    if (value instanceof WeakMap) {
      return '[WeakMap]';
    }
    if (value instanceof WeakSet) {
      return '[WeakSet]';
    }

    if (value instanceof Error) {
      return {
        '[Error]': {
          name: value.name,
          message: value.message,
          stack: value.stack
        }
      };
    }

    // For plain objects and arrays, continue recursion
    return value;
  }

  // Fallback for any other type
  return `[${typeof value}]`;
}

/**
 * Simple replacer function for MCP responses - only handles Maps and Sets with "type" field
 */
export function mapSetReflexReplacer(_key: string, value: any): any {
  // Handle Maps
  if (value instanceof Map) {
    return {
      type: 'map',
      entries: Array.from(value.entries())
    };
  }
  // Handle Sets
  if (value instanceof Set) {
    return {
      type: 'set',
      values: Array.from(value)
    };
  }

  // For all other values, return as-is (let JSON.stringify handle them)
  return value;
}