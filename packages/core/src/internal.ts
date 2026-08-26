/**
 * Internal adapters retained for tests and backward compatibility.
 *
 * This entrypoint is intentionally not re-exported from the package root or
 * vanilla API. Application code should use the production runtime client;
 * integrations should use getRuntimeIntegration from the vanilla entrypoint.
 */
import { createUkladRuntimeForTests } from './runtime/runtime';

/** @internal Test-only owner facade with administrative operations attached. */
export { createUkladRuntimeForTests };

// Backward-compatible first-party entrypoint. New integrations import the
// supported capability from @ukladjs/core/vanilla.
export { getRuntimeIntegration } from './runtime/integration';
export type { UkladRuntimeIntegration } from './runtime/integration';
