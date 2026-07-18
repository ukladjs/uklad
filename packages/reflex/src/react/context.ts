import { createContext, createElement, useContext } from 'react';

import { defaultRuntime, type ReflexRuntime } from '../runtime/runtime';

import type { ReactElement, ReactNode } from 'react';
import type { PermissiveReflexContracts, ReflexContracts } from '../contracts';

const ReflexRuntimeContext = createContext<ReflexRuntime<ReflexContracts>>(
  defaultRuntime as unknown as ReflexRuntime<ReflexContracts>,
);

export interface ReflexProviderProps {
  readonly runtime: ReflexRuntime<any>;
  readonly children?: ReactNode;
}

/** Select a Reflex runtime for every descendant Reflex hook. */
export function ReflexProvider({ runtime, children }: ReflexProviderProps): ReactElement {
  return createElement(
    ReflexRuntimeContext.Provider,
    { value: runtime as ReflexRuntime<ReflexContracts> },
    children,
  );
}

/** Return the nearest provider runtime, or the compatibility default runtime. */
export function useReflexRuntime<
  TContracts extends ReflexContracts = PermissiveReflexContracts,
>(): ReflexRuntime<TContracts> {
  return useContext(ReflexRuntimeContext) as unknown as ReflexRuntime<TContracts>;
}
