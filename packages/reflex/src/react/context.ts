import { createContext, createElement, useContext } from 'react';

import type { ReflexRuntime } from '../runtime/api';

import type { ReactElement } from 'react';
import type { PermissiveReflexContracts, ReflexContracts } from '../contracts';
import type { ReflexProviderProps } from './types';

export type { ReflexProviderProps } from './types';

const ReflexRuntimeContext = createContext<ReflexRuntime<ReflexContracts> | null>(null);

/** Select a Reflex runtime for every descendant Reflex hook. */
export function ReflexProvider({ runtime, children }: ReflexProviderProps): ReactElement {
  return createElement(
    ReflexRuntimeContext.Provider,
    { value: runtime as ReflexRuntime<ReflexContracts> },
    children,
  );
}

/** Return the nearest explicitly provided runtime. */
export function useReflexRuntime<
  TContracts extends ReflexContracts = PermissiveReflexContracts,
>(): ReflexRuntime<TContracts> {
  const runtime = useContext(ReflexRuntimeContext);
  if (!runtime) {
    throw new Error('[reflex] Reflex hooks require a <ReflexProvider runtime={...}> ancestor.');
  }
  return runtime as unknown as ReflexRuntime<TContracts>;
}
