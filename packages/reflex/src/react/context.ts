import { createContext, createElement, useContext } from 'react';

import { getRuntimeClient } from '../runtime/runtime';
import type { ReflexRuntimeClient } from '../runtime/api';

import type { ReactElement } from 'react';
import type { PermissiveReflexContracts, ReflexContracts } from '../contracts';
import type { ReflexProviderProps } from './types';

export type { ReflexProviderProps } from './types';

const ReflexRuntimeContext = createContext<ReflexRuntimeClient<ReflexContracts> | null>(null);

/** Select a Reflex runtime for every descendant Reflex hook. */
export function ReflexProvider({ runtime, children }: ReflexProviderProps): ReactElement {
  return createElement(
    ReflexRuntimeContext.Provider,
    { value: getRuntimeClient(runtime) as ReflexRuntimeClient<ReflexContracts> },
    children,
  );
}

/** Return the nearest explicitly provided runtime. */
export function useReflexRuntime<
  TContracts extends ReflexContracts = PermissiveReflexContracts,
>(): ReflexRuntimeClient<TContracts> {
  const runtime = useContext(ReflexRuntimeContext);
  if (!runtime) {
    throw new Error('[reflex] Reflex hooks require a <ReflexProvider runtime={...}> ancestor.');
  }
  return runtime as unknown as ReflexRuntimeClient<TContracts>;
}
