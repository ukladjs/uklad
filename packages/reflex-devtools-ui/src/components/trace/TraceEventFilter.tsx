import { useCallback } from 'react';
import { useSubscription, dispatch } from '@flexsurfer/reflex';

export default function EventFilter() {
    const filter = useSubscription<string>(['filter']);

    const handleClearFilter = useCallback(() => {
        dispatch(['set-filter', '']);
    }, []);

    const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        dispatch(['set-filter', e.target.value]);
    }, []);

    return (
        <label className="input input-bordered input-sm flex-1 bg-base-100">
            <svg className="h-[1em] opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <g strokeLinejoin="round" strokeLinecap="round" strokeWidth="2.5" fill="none" stroke="currentColor">
                    <path d="M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.586a1 1 0 0 1-.293.707l-6.414 6.414a1 1 0 0 0-.293.707V17l-4 4v-6.586a1 1 0 0 0-.293-.707l-6.414-6.414A1 1 0 0 1 3 6.586V4z"></path>
                </g>
            </svg>
            <input
                type="text"
                placeholder="event-id"
                value={filter}
                onChange={handleFilterChange}
                className="grow"
            />
            {filter && (
                <svg onClick={handleClearFilter} className="h-[1.2em] opacity-70 cursor-pointer" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <g strokeLinejoin="round" strokeLinecap="round" strokeWidth="2.5" fill="none" stroke="currentColor">
                        <path d="M18 6L6 18" />
                        <path d="M6 6L18 18" />
                    </g>
                </svg>
            )}
        </label>
    );
} 