import { useState } from 'react';
import { useSubscription } from '@flexsurfer/reflex';
import SortIndicator from './ui/SortIndicator';

type SortField = 'handlerId' | 'runs';
type SortDirection = 'asc' | 'desc';

export default function HandlersTable() {
    const handlerKeys = useSubscription<{ event: string[]; fx: string[]; cofx: string[]; sub: string[]; } | null>(['handlerKeys']);
    const handlerUsage = useSubscription<Record<string, Record<string, number>> | null>(['handlerUsage']);
    const [activeTab, setActiveTab] = useState<string>('event');
    const [sortField, setSortField] = useState<SortField>('handlerId');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

    if (!handlerKeys) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-base-content/60 text-center">
                <p className="text-lg font-medium">No handlers registered yet...</p>
                <p className="text-sm">Handlers will appear here when your app is running</p>
            </div>
        );
    }

    const handlerTypes = [
        { key: 'event', label: 'Events', items: handlerKeys.event },
        { key: 'fx', label: 'Effects', items: handlerKeys.fx },
        { key: 'cofx', label: 'Coeffects', items: handlerKeys.cofx },
        { key: 'sub', label: 'Subscriptions', items: handlerKeys.sub }
    ];

    // Filter out handler types with no items
    const activeHandlerTypes = handlerTypes.filter(type => type.items.length > 0);

    if (activeHandlerTypes.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-base-content/60 text-center">
                <p className="text-lg font-medium">No handlers registered yet...</p>
                <p className="text-sm">Handlers will appear here when your app is running</p>
            </div>
        );
    }
    const currentHandlerType = activeHandlerTypes.find(type => type.key === activeTab) || activeHandlerTypes[0];

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    // Sort the handler items based on current sort field and direction
    const sortedItems = [...currentHandlerType.items].sort((a, b) => {
        let comparison = 0;

        if (sortField === 'handlerId') {
            comparison = a.localeCompare(b);
        } else if (sortField === 'runs') {
            const aRuns = handlerUsage?.[currentHandlerType.key]?.[a] || 0;
            const bRuns = handlerUsage?.[currentHandlerType.key]?.[b] || 0;
            comparison = aRuns - bRuns;
        }

        return sortDirection === 'asc' ? comparison : -comparison;
    });

    return (
        <div className="flex flex-col h-full">
            {/* Tabs */}
            <div className="tabs tabs-boxed bg-base-200 p-1 mx-4 mt-4">
                {activeHandlerTypes.map(({ key, label, items }) => (
                    <a
                        key={key}
                        className={`tab ${currentHandlerType.key === key ? 'tab-active' : ''}`}
                        onClick={() => setActiveTab(key)}
                    >
                        {label} ({items.length})
                    </a>
                ))}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="bg-base-100 rounded-lg border border-base-300 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="table table-zebra w-full table-xs">
                            <thead className="bg-base-200">
                                <tr>
                                    <th className="text-left text-sm font-medium text-base-content">
                                        <button
                                            className="flex items-center gap-1 hover:text-base-content/80 cursor-pointer"
                                            onClick={() => handleSort('handlerId')}
                                        >
                                            Handler ID
                                            {sortField === 'handlerId' && (
                                                <SortIndicator direction={sortDirection} />
                                            )}
                                        </button>
                                    </th>
                                    <th className="text-right text-sm font-medium text-base-content">
                                        <button
                                            className="flex items-center justify-end gap-1 hover:text-base-content/80 cursor-pointer w-full"
                                            onClick={() => handleSort('runs')}
                                        >
                                            Runs
                                            {sortField === 'runs' && (
                                                <SortIndicator direction={sortDirection} />
                                            )}
                                        </button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedItems.map((handlerId, index) => {
                                    const usageCount = handlerUsage?.[currentHandlerType.key]?.[handlerId] || 0;
                                    return (
                                        <tr key={index}>
                                            <td className="text-xs font-mono text-base-content px-4 py-2 opacity-80">
                                                {handlerId}
                                            </td>
                                            <td className="text-xs text-base-content px-4 py-2 text-right font-mono">
                                                {usageCount}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
