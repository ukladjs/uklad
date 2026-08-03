import { useCallback, useRef, useState } from 'react';
import { dispatch } from '../../runtime';
import EventFilter from './TraceEventFilter';
import TraceViewPanel from './TraceViewPanel';
import DispatchButton from '../ui/DispatchButton';

export default function TracesControls() {
    const [isPanelOpen, setisPanelOpen] = useState(false);
    const viewButtonRef = useRef<HTMLButtonElement>(null);

    const handleClearEvents = useCallback(() => {
        dispatch(['clear-traces']);
    }, []);

    const handleToggleSettings = useCallback(() => {
        setisPanelOpen((isOpen) => !isOpen);
    }, []);

    const handleDispatchClick = useCallback(() => {
        dispatch(['open-dispatch-modal', '', []]);
    }, []);

    return (
        <div className="flex flex-col p-2 gap-2 bg-base-200 border-b border-base-300">
            <div className="flex items-center gap-2 justify-between relative">
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <button ref={viewButtonRef} onClick={handleToggleSettings} className="btn btn-sm btn-ghost">
                            View
                        </button>
                        <TraceViewPanel isOpen={isPanelOpen} onClose={() => setisPanelOpen(false)} triggerRef={viewButtonRef} />
                    </div>
                    <DispatchButton onClick={handleDispatchClick} />
                </div>
                <button onClick={handleClearEvents} className="btn btn-sm">
                    Clear
                </button>
            </div>
            <div className="flex gap-2">
                <EventFilter />
            </div>
        </div>
    );
} 
