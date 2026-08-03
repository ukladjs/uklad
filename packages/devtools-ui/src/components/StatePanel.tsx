import { useState } from 'react';
import { useSubscription } from '@ukladjs/core';
import { JsonViewer } from './ui/JsonViewer';
import HandlersTable from './HandlersTable';

export default function StatePanel() {
    const state = useSubscription(['state']);
    const activeSubs = useSubscription(['activeSubs']);
    const [viewMode, setViewMode] = useState<'state' | 'subscriptions' | 'handlers'>('state');
    const hasActiveSubs = activeSubs != null && Object.keys(activeSubs).length > 0;

    return (
        <div className="flex flex-col bg-base-100 h-full overflow-hidden">
            <div className="p-2 bg-base-200 border-b border-base-300 pt-3">
                <button
                    onClick={() => setViewMode('state')}
                    className={`btn btn-xs ${viewMode === 'state' ? 'btn-primary' : 'btn-ghost'}`}
                >
                    State
                </button>
                <button
                    onClick={() => setViewMode('subscriptions')}
                    className={`btn btn-xs ${viewMode === 'subscriptions' ? 'btn-primary' : 'btn-ghost'}`}
                >
                    Subscriptions
                </button>
                <button
                    onClick={() => setViewMode('handlers')}
                    className={`btn btn-xs ${viewMode === 'handlers' ? 'btn-primary' : 'btn-ghost'}`}
                >
                    Handlers
                </button>
            </div>

            <div className="flex-1 overflow-y-auto relative">
                <div className={`absolute inset-0 overflow-y-auto ${viewMode === 'state' ? '' : 'invisible pointer-events-none'}`}>
                    {!state ? (
                        <div className="flex flex-col items-center justify-center h-full text-base-content/60 text-center">
                            <p className="text-lg font-medium">No state state yet...</p>
                            <p className="text-sm">Run your app with devtools enabled to see state state here</p>
                        </div>
                    ) : (
                        <JsonViewer src={state} name="state" />
                    )}
                </div>
                <div className={`absolute inset-0 overflow-y-auto ${viewMode === 'subscriptions' ? '' : 'invisible pointer-events-none'}`}>
                    {!hasActiveSubs ? (
                        <div className="flex flex-col items-center justify-center h-full text-base-content/60 text-center">
                            <p className="text-lg font-medium">No active subscriptions yet...</p>
                            <p className="text-sm">Active subscriptions will appear here when your app is running</p>
                        </div>
                    ) : (
                        <JsonViewer src={activeSubs} name="activeSubscriptions" expandLevel={1} />
                    )}
                </div>
                <div className={`absolute inset-0 overflow-y-auto ${viewMode === 'handlers' ? '' : 'invisible pointer-events-none'}`}>
                    <HandlersTable />
                </div>
            </div>
        </div>
    );
} 
