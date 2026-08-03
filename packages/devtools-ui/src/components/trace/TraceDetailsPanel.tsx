import { useSubscription } from '@ukladjs/core';
import type { TraceItem } from '../../types/Trace';
import TraceEventDetails from './TraceEventDetails';
import TraceRenderDetails from './TraceRenderDetails';
import { Badge } from '../ui/Badge';

export default function TraceDetailsPanel() {
    const selectedTrace = useSubscription<TraceItem | null>(['selectedTrace']);

    return (
        <div className="flex flex-col bg-base-100 h-full overflow-hidden">
            <div className="p-3 bg-base-200 border-b border-base-300 flex flex-row items-center gap-3">
                <h2 className="text-sm">Trace Details</h2>
                {selectedTrace && (
                    selectedTrace.badges.map((badge) => (
                        <Badge key={badge.label} opType={badge.label} label={badge.label + ": " + badge.number} size="sm" style="outline" />
                    ))
                )}
            </div>

            <div className="flex-1 overflow-hidden flex">
                {!selectedTrace ? (
                    <div className="flex flex-1 flex-col items-center justify-center h-full text-base-content/60 text-center">
                        <p className="text-lg font-medium">No trace selected...</p>
                        <p className="text-sm">Click on a trace item to see its details here</p>
                    </div>
                ) : selectedTrace.type === 'event' ?
                    <TraceEventDetails tags={selectedTrace.traces[0]?.tags ?? {}} /> :
                    <TraceRenderDetails traces={selectedTrace.traces} />}
            </div>
        </div>
    );
} 