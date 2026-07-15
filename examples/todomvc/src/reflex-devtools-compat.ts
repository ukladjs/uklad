/**
 * Compatibility boundary for reflex-devtools 0.1.x.
 *
 * The published client still imports the removed `getReactions` API. Keep that
 * legacy shape local to the example while the library itself exposes only the
 * immutable subscription diagnostics contract.
 */
import { getSubscriptionDiagnostics } from '../../../src/index';

export * from '../../../src/index';

interface LegacyReactionDiagnostic {
  readonly isRoot: boolean;
  readonly isAlive: boolean;
  getVersion(): number;
  getValue(): unknown;
}

interface LegacyReactionSnapshot {
  readonly isRoot: boolean;
  readonly isAlive: boolean;
  readonly version: number;
  readonly value: unknown;
}

let previousReactions = new Map<string, LegacyReactionSnapshot>();

function toLegacyReaction(snapshot: LegacyReactionSnapshot): LegacyReactionDiagnostic {
  return {
    isRoot: snapshot.isRoot,
    isAlive: snapshot.isAlive,
    getVersion: () => snapshot.version,
    getValue: () => snapshot.value,
  };
}

export function getReactions(): ReadonlyMap<string, LegacyReactionDiagnostic> {
  const currentReactions = new Map<string, LegacyReactionSnapshot>(
    getSubscriptionDiagnostics().map((diagnostic) => [
      diagnostic.key,
      {
        isRoot: diagnostic.kind === 'root',
        isAlive: diagnostic.active,
        version: diagnostic.version,
        value: diagnostic.value,
      },
    ]),
  );

  const reactions = new Map<string, LegacyReactionDiagnostic>();
  for (const [key, snapshot] of currentReactions) {
    reactions.set(key, toLegacyReaction(snapshot));
  }

  // The old client detects disposal by observing an alive reaction become
  // dead. Modern diagnostics remove disposed cache entries, so expose a
  // one-poll tombstone for entries that disappeared since the previous read.
  for (const [key, snapshot] of previousReactions) {
    if (!currentReactions.has(key) && snapshot.isAlive) {
      reactions.set(key, toLegacyReaction({ ...snapshot, isAlive: false }));
    }
  }

  previousReactions = currentReactions;
  return reactions;
}
