import { useState, useCallback, useEffect } from 'react';
import { JsonViewer } from '../ui/JsonViewer';
import { DiffViewer } from '../ui/DiffViewer';
import DispatchButton from '../ui/DispatchButton';
import { dispatch } from '../../runtime';

export default function TraceEventDetails({ tags }: { tags: { [key: string]: any } }) {
    const hasStateChanges = Array.isArray(tags.patches) && tags.patches.length > 0;
    const hasEffects = Array.isArray(tags.effects) && tags.effects.length > 0;
    const defaultViewMode = hasStateChanges ? 'state' : hasEffects ? 'effects' : 'data';
    const [viewMode, setViewMode] = useState<'data' | 'state' | 'effects'>(defaultViewMode);

    useEffect(() => {
        setViewMode(defaultViewMode);
    }, [tags, defaultViewMode]);

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
                    {hasStateChanges && (
                        <button
                            onClick={() => setViewMode('state')}
                            className={`btn btn-xs ${viewMode === 'state' ? 'btn-primary' : 'btn-ghost'}`}
                        >
                            State
                        </button>
                    )}
                    {hasEffects && (
                        <button
                            onClick={() => setViewMode('effects')}
                            className={`btn btn-xs ${viewMode === 'effects' ? 'btn-primary' : 'btn-ghost'}`}
                        >
                            Effects
                        </button>
                    )}
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
                {viewMode === 'state' ? (
                    <DiffViewer patches={tags.patches} reversePatches={tags.reversePatches} />
                ) : viewMode === 'effects' ? (
                    <JsonViewer
                        src={tags.effects.map((effect: unknown) => {
                            if (Array.isArray(effect)) {
                                return { name: effect[0], params: effect[1] };
                            }
                            return { name: '<invalid effect>', params: effect };
                        })}
                        name="effects"
                    />
                ) : (
                    <JsonViewer src={tags} name="event" />
                )}
            </div>
        </div>
    );
}
