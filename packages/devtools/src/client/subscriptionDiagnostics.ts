import type { UkladSubscriptionDiagnostic } from './types.js';

export const DISPOSED_SUBSCRIPTION = 'uklad-tool-sub-disposed';

/**
 * Convert the runtime's cache-only diagnostics into the existing devtools
 * delta protocol. The cache belongs to the client connection, not Uklad.
 */
export function diffSubscriptionDiagnostics(
  diagnostics: readonly UkladSubscriptionDiagnostic[],
  versions: Map<string, number>,
  resetCache = false,
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  const activeKeys = new Set<string>();

  for (const diagnostic of diagnostics) {
    if (!diagnostic.active) continue;
    // Empty is not a displayable value. Treat it as absent so a previously
    // published value is removed instead of lingering in the UI/server.
    if (diagnostic.status === 'empty') continue;

    activeKeys.add(diagnostic.key);
    if (!resetCache && versions.get(diagnostic.key) === diagnostic.version) continue;

    changed[diagnostic.key] =
      diagnostic.status === 'error'
        ? { '[SubscriptionError]': diagnostic.error ?? 'Unknown subscription error' }
        : diagnostic.value;
    versions.set(diagnostic.key, diagnostic.version);
  }

  // A diagnostic can disappear entirely when Uklad evicts its cached graph,
  // so disposal detection must compare key sets instead of inspecting nodes.
  for (const key of Array.from(versions.keys())) {
    if (activeKeys.has(key)) continue;
    changed[key] = DISPOSED_SUBSCRIPTION;
    versions.delete(key);
  }

  return changed;
}
