import { useState } from 'react';
import type { Trace } from '../../types/Trace';
import { Badge } from '../ui/Badge';
import GraphView from './GraphView.tsx';

export default function TraceRenderDetails({ traces }: { traces: Trace[] }) {
    const [mode, setMode] = useState<'table' | 'graph'>('table');

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex gap-2 p-2 border-b border-base-300">
                <button
                    className={`btn btn-xs ${mode === 'table' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setMode('table')}
                >
                    Table
                </button>
                <button
                    className={`btn btn-xs ${mode === 'graph' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setMode('graph')}
                >
                    Graph
                </button>
            </div>

            {mode === 'table' ? (
                <div className="flex-1 overflow-x-auto overflow-y-auto">
                    <table className="table table-zebra w-full table-xs">
                        <thead className="sticky top-0 bg-base-100">
                            <tr>
                                <th>Op Type</th>
                                <th>Operation</th>
                                <th>Duration (ms)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {traces.map((trace, index) => (
                                <tr key={trace.id || index}>
                                    <td>
                                        <Badge opType={trace.opType ?? ''} label={trace.opType ?? ''} />
                                    </td>
                                    <td className="font-mono text-xs">
                                        {JSON.stringify(trace.tags?.queryV ?? trace.operation).slice(0, 70) || '-'}
                                    </td>
                                    <td className="text-xs">
                                        {trace.duration ? `${trace.duration.toFixed(2)}` : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <GraphView traces={traces} />
            )}
        </div>
    );
} 