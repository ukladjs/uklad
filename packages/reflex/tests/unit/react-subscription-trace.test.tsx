/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import { ReflexProvider } from '../../src/react/context';
import { useSubscription } from '../../src/react/use-subscription';
import {
  createReflexRuntimeForTests as createReflexRuntime,
  getRuntimeAdminForTests,
} from '../../src/runtime/runtime';

const waitForTraceFlush = () => new Promise((resolve) => setTimeout(resolve, 80));

describe('React subscription tracing', () => {
  it('records hook notifications as render traces rather than watches', async () => {
    const runtime = createReflexRuntime({ initialState: { value: 1 }, runtimeId: 'render-trace' });
    const traces: Array<{ opType?: string }> = [];
    runtime.registerModule((registrar) => {
      registrar.regRootSub('value', 'value');
    });
    runtime.registerModule((registrar) => {
      registrar.regEvent('set-value', ({ draftState }, value: number) => {
        draftState.value = value;
      });
    });
    const admin = getRuntimeAdminForTests(runtime);
    admin.enableTracing();
    admin.registerTraceCallback('react-render-trace', (batch) => traces.push(...batch));

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ReflexProvider, { runtime }, children);
    const hook = renderHook(() => useSubscription<number>(['value']), { wrapper });

    act(() => {
      runtime.dispatchSync(['set-value', 2]);
    });

    await waitFor(() => expect(hook.result.current).toBe(2));
    await waitForTraceFlush();

    expect(traces.some((trace) => trace.opType === 'render')).toBe(true);
    expect(traces.some((trace) => trace.opType === 'watch')).toBe(false);

    hook.unmount();
    admin.removeTraceCallback('react-render-trace');
    admin.disableTracing();
    runtime.dispose();
  });
});
