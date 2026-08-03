import type { Trace } from '../types/Trace';

export interface GraphNode {
    id: string;
    type: string;
    label: string;
    level: number;
    order: number;
}

export interface GraphLink {
    source: string;
    target: string;
    leadsToRender?: boolean;
}

export interface GraphData {
    nodes: GraphNode[];
    links: GraphLink[];
}

export function createGraphData(traces: Trace[]): GraphData {
    const nodes = new Map<string, GraphNode>();
    const links: GraphLink[] = [];

    // First pass: collect all subscription instances represented in this flush.
    const existingSubscriptions = new Set<string>();
    traces.forEach(trace => {
        if (trace.opType === 'sub/run' && trace.tags?.subscriptionKey) {
            existingSubscriptions.add(trace.tags.subscriptionKey);
        }
    });

    // Add root node
    nodes.set('state', { id: 'state', type: 'state', label: 'state', level: 0, order: 0 });

    // Track render node IDs for later path tracing
    const renderNodeIds: string[] = [];

    // Process traces
    traces.forEach(trace => {
        if (trace.opType === 'sub/run') {
            const subscriptionKey = trace.tags?.subscriptionKey;
            if (subscriptionKey) {
                if (!nodes.has(subscriptionKey)) {
                    nodes.set(subscriptionKey, { id: subscriptionKey, type: 'sub/run', label: subscriptionKey, level: 0, order: 0 });
                }
                const deps = trace.tags?.deps || [];
                if (deps.length === 0) {
                    links.push({ source: 'state', target: subscriptionKey });
                } else {
                    deps.forEach((dep: string) => {
                        if (existingSubscriptions.has(dep)) {
                            if (!nodes.has(dep)) {
                                nodes.set(dep, { id: dep, type: 'sub/run', label: dep, level: 0, order: 0 });
                            }
                            links.push({ source: dep, target: subscriptionKey });
                        }
                    });
                }
            }
        } else if (trace.opType === 'render') {
            const dep = trace.tags?.subscriptionKey;
            if (dep) {
                const renderId = `render_${trace.id}`;
                nodes.set(renderId, { id: renderId, type: 'render', label: trace.operation ?? 'Component', level: 0, order: 0 });
                renderNodeIds.push(renderId);
                if (existingSubscriptions.has(dep)) {
                    if (!nodes.has(dep)) {
                        nodes.set(dep, { id: dep, type: 'sub/run', label: dep, level: 0, order: 0 });
                    }
                    links.push({ source: dep, target: renderId });
                }
            }
        }
    });

    // Build adjacency map for backward traversal
    const incomingLinks = new Map<string, GraphLink[]>();
    links.forEach(link => {
        const targetId = typeof link.target === 'string' ? link.target : (link.target as any).id;
        if (!incomingLinks.has(targetId)) incomingLinks.set(targetId, []);
        incomingLinks.get(targetId)!.push(link);
    });

    // Trace back from render nodes and mark links
    renderNodeIds.forEach(renderId => {
        const visited = new Set<string>();
        const queue = [renderId];
        while (queue.length > 0) {
            const nodeId = queue.shift()!;
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);
            (incomingLinks.get(nodeId) || []).forEach(link => {
                link.leadsToRender = true;
                const sourceId = typeof link.source === 'string' ? link.source : (link.source as any).id;
                if (!visited.has(sourceId)) queue.push(sourceId);
            });
        }
    });

    return { nodes: Array.from(nodes.values()), links };
}
