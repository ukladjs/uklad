import TracesControls from './trace/TracesControls';
import TracesList from './trace/TracesList';

export default function TracesListPanel() {
    return (
        <div className="flex flex-col bg-base-100 border-r border-base-300 h-full overflow-hidden">
            <TracesControls />
            <TracesList />
        </div>
    );
} 