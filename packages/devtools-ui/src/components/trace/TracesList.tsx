import { useRef, useEffect, useState } from 'react';
import type { TraceItem } from '../../types/Trace';
import TraceListItem from './TraceListItem';
import { useSubscription } from '@ukladjs/core';

export default function TracesList() {
    const eventsEndRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLUListElement>(null);
    const [isAtBottom, setIsAtBottom] = useState(true);

    const traces = useSubscription<TraceItem[]>(['filteredTraces']);
    const selectedTrace = useSubscription<TraceItem | null>(['selectedTrace']);
    const showBadges = useSubscription<boolean>(['showBadges']);
    const showParams = useSubscription<boolean>(['showParams']);
    const showTimestamps = useSubscription<boolean>(['showTimestamps']);

    useEffect(() => {
        const handleScroll = () => {
            const el = contentRef.current;
            if (el) {
                setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 10);
            }
        };

        const el = contentRef.current;
        el?.addEventListener('scroll', handleScroll);
        return () => el?.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        if (isAtBottom) {
            eventsEndRef.current?.scrollIntoView();
        }
    }, [traces.length, isAtBottom]);

    return (
        <ul className="flex-1 overflow-y-auto bg-base-200 p-0" ref={contentRef}>
            {traces.length === 0 ? (
                <li className="h-full">
                    <div className="flex flex-col items-center justify-center h-full text-base-content/60 text-center">
                        <p className="text-sm">No traces yet...</p>
                    </div>
                </li>
            ) : (
                traces.map((trace, index) => {
                    const selected = selectedTrace?.id === trace.id;
                    return (
                        <TraceListItem
                            key={index}
                            item={trace}
                            selected={selected}
                            showBadges={showBadges}
                            showParams={showParams}
                            showTimestamps={showTimestamps}
                        />
                    );
                })
            )}
            <div ref={eventsEndRef} />
        </ul>
    );
} 