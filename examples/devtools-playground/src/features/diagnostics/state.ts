/**
 * Roots owned by the `diagnostics` feature.
 *
 * This feature exists only to drive the devtools: it produces the awkward
 * shapes — deep nesting, non-serializable payloads, Immer drafts escaping into
 * an effect, deep Map/Set trees — that a normal application never stores. They
 * are declared roots like any other, so the catalog stays the whole truth
 * about this app's state.
 */

/** Written by `diagnostics/write-nested` so devtools has depth to render. */
export interface DiagnosticsNested {
  label: string;
  child: { label: string };
}

/** Whatever `diagnostics/bad-params` was dispatched with, including values JSON cannot carry. */
export type DiagnosticsPayload = unknown;

/** Handed to an effect as a live draft value by `diagnostics/immer-proxy`. */
export interface DiagnosticsImmerProbe {
  test: string;
}

/** A deep Map/Set tree, built on demand by `diagnostics/create-complex-structure`. */
export type DiagnosticsComplex = Map<string, unknown> | null;

export function createDiagnosticsNested(): DiagnosticsNested | null {
  return null;
}

export function createDiagnosticsPayload(): DiagnosticsPayload {
  return null;
}

export function createDiagnosticsImmerProbe(): DiagnosticsImmerProbe {
  return { test: 'test' };
}

export function createDiagnosticsComplex(): DiagnosticsComplex {
  return null;
}
