/**
 * Environment detection utilities
 */

// Type declarations for cross-platform environments
declare const process:
  | {
      env?: {
        NODE_ENV?: string;
      };
    }
  | undefined;

declare const __DEV__: boolean | undefined;

/**
 * Checks if the current environment is development
 * Works across Node.js, React Native, Vite, and Deno
 */
export const IS_DEV: boolean =
  // Node.js check
  (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') ||
  // React Native / bundler check
  (typeof __DEV__ !== 'undefined' && __DEV__);
