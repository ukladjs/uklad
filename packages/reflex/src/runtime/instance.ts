import { IS_DEV } from '../core/environment';
import { consoleLog } from '../core/logging';

declare const process:
  | {
      env?: {
        NODE_ENV?: string;
      };
      versions?: {
        node?: string;
      };
    }
  | undefined;

const RUNTIME_MARKER_KEY = Symbol.for('@flexsurfer/reflex/runtime');
const RUNTIME_MARKER_VERSION = 1;
const SHOULD_DETECT_DUPLICATE_RUNTIME =
  IS_DEV ||
  (typeof process !== 'undefined' &&
    typeof process.versions?.node === 'string' &&
    process.env?.NODE_ENV === undefined);

interface RuntimeMarker {
  readonly markerVersion: number;
  readonly instance: object;
}

const runtimeInstance = Object.freeze({});

/**
 * @internal Register one module-local runtime identity in the current realm.
 * Exported only so duplicate detection can be tested without loading two builds.
 */
export function registerRuntimeInstance(instance: object): void {
  if (!SHOULD_DETECT_DUPLICATE_RUNTIME) return;

  let existing: unknown;
  try {
    existing = Reflect.get(globalThis, RUNTIME_MARKER_KEY);
  } catch {
    return;
  }

  if (existing === undefined) {
    const marker: RuntimeMarker = Object.freeze({
      markerVersion: RUNTIME_MARKER_VERSION,
      instance,
    });
    try {
      Object.defineProperty(globalThis, RUNTIME_MARKER_KEY, {
        configurable: true,
        enumerable: false,
        writable: false,
        value: marker,
      });
    } catch {
      // Duplicate detection must not prevent Reflex from loading in a hardened realm.
    }
    return;
  }

  if (getMarkedInstance(existing) === instance) return;

  try {
    consoleLog(
      'warn',
      '[reflex] Multiple Reflex runtimes detected in the same JavaScript realm. Each copy owns a separate app-db, handler registry, subscription cache, and trace callback registry; Reflex will not merge state across copies. Ensure your application resolves a single copy of @flexsurfer/reflex.',
    );
  } catch {
    // A diagnostic must not make module initialization fail.
  }
}

function getMarkedInstance(value: unknown): object | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  try {
    const markerVersion = Reflect.get(value, 'markerVersion');
    const instance = Reflect.get(value, 'instance');
    return typeof markerVersion === 'number' && typeof instance === 'object' && instance !== null
      ? instance
      : undefined;
  } catch {
    return undefined;
  }
}

registerRuntimeInstance(runtimeInstance);
