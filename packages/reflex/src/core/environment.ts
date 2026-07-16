declare const process:
  | {
      env?: {
        NODE_ENV?: string;
      };
    }
  | undefined;

declare const __DEV__: boolean | undefined;

/**
 * Whether this module loaded in development mode.
 *
 * Reflex recognizes `NODE_ENV=development` and the React Native-style
 * `__DEV__` global. Environments with another convention must expose one of
 * those values before this module is evaluated.
 */
export const IS_DEV: boolean =
  (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') ||
  (typeof __DEV__ !== 'undefined' && __DEV__);
