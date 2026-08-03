import { useState, useCallback } from 'react';
import { JsonViewer } from '../ui/JsonViewer';
import { DiffViewer } from '../ui/DiffViewer';
import DispatchButton from '../ui/DispatchButton';
import { dispatch } from '../../runtime';

export default function TraceEventDetails({ tags }: { tags: { [key: string]: any } }) {
    const [viewMode, setViewMode] = useState<'data' | 'diff'>('diff');

    const handleDispatchClick = useCallback(() => {
        const eventData = tags.event;
        if (Array.isArray(eventData) && eventData.length > 0) {
            const eventName = eventData[0];
            const params = eventData.length > 1 ? eventData.slice(1) : [];
            dispatch(['open-dispatch-modal', eventName, params]);
        }
    }, [tags]); 

    return (
        <div className="flex-1 flex flex-col">
            <div className="flex gap-2 p-2 border-b border-base-300 justify-between">
                <div className="flex gap-2">
                    <button
                        onClick={() => setViewMode('diff')}
                        className={`btn btn-xs ${viewMode === 'diff' ? 'btn-primary' : 'btn-ghost'}`}
                    >
                        Diff
                    </button>
                    <button
                        onClick={() => setViewMode('data')}
                        className={`btn btn-xs ${viewMode === 'data' ? 'btn-primary' : 'btn-ghost'}`}
                    >
                        Raw Data
                    </button>
                </div>
                <DispatchButton size="xs" onClick={handleDispatchClick} />
            </div>
            <div className="flex-1 overflow-y-auto">
                {viewMode === 'data' ? (
                    <JsonViewer src={tags} name="event" />
                ) : (
                    <DiffViewer patches={tags.patches} reversePatches={tags.reversePatches} />
                )}
            </div>
        </div>
    );
}
