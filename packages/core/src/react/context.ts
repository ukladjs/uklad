import { createContext, createElement, useContext } from 'react';

import { getRuntimeClient } from '../runtime/runtime';
import type { UkladRuntimeClient } from '../runtime/api';

import type { ReactElement } from 'react';
import type { PermissiveUkladContracts, UkladContracts } from '../contracts';
import type { UkladProviderProps } from './types';

export type { UkladProviderProps } from './types';

const UkladRuntimeContext = createContext<UkladRuntimeClient<UkladContracts> | null>(null);

/** Select a Uklad runtime for every descendant Uklad hook. */
export function UkladProvider({ runtime, children }: UkladProviderProps): ReactElement {
  return createElement(
    UkladRuntimeContext.Provider,
    { value: getRuntimeClient(runtime) as UkladRuntimeClient<UkladContracts> },
    children,
  );
}

/**
 * Return the nearest explicitly provided runtime.
 *
 * `TContracts` is an unchecked assertion, not a check: this context is created
 * once with a fixed type, so nothing relates the argument passed here to the
 * runtime a provider actually supplied. Passing a contract the provided runtime
 * was not built for compiles and then misreports `dispatch`.
 *
 * Use the `useRuntime` returned by `createUkladHooks<TContracts>()` to get the
 * same client checked against the contract its paired provider enforces.
 */
export function useUkladRuntime<
  TContracts extends UkladContracts = PermissiveUkladContracts,
>(): UkladRuntimeClient<TContracts> {
  const runtime = useContext(UkladRuntimeContext);
  if (!runtime) {
    throw new Error('[uklad] Uklad hooks require a <UkladProvider runtime={...}> ancestor.');
  }
  return runtime as unknown as UkladRuntimeClient<TContracts>;
}
