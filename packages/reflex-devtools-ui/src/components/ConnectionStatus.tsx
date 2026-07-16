import { useSubscription } from '@flexsurfer/reflex';

export default function ConnectionStatus() {
    const isConnected = useSubscription<boolean>(['isConnected']);
    return (
        <div className={`status ${isConnected ? 'status-success' : 'status-error'}`}></div>
    );
} 