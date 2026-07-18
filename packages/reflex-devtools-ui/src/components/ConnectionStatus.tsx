import { useSubscription } from '@flexsurfer/reflex';
import type { DevtoolsRuntimeSummary } from '../types/Runtime';

export default function ConnectionStatus() {
    const isConnected = useSubscription<boolean>(['isConnected']);
    const runtimes = useSubscription<DevtoolsRuntimeSummary[]>(['runtimes']) ?? [];
    const selectedRuntimeId = useSubscription<string | null>(['selectedRuntimeId']);
    const runtimeConnected = runtimes.some(
        (runtime) => runtime.runtimeId === selectedRuntimeId && runtime.connected,
    );
    const connected = isConnected && runtimeConnected;
    return (
        <div
            className={`status ${connected ? 'status-success' : 'status-error'}`}
            title={connected ? 'Selected runtime connected' : 'No selected runtime connection'}
        ></div>
    );
}
