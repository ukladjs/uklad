import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { Trace } from '../../types/Trace';
import { useTheme } from '../../contexts/ThemeContext';
import ForceGraph2D from 'react-force-graph-2d';
import { createGraphData } from '../../utils/graphUtils';

function getNodeColor(type: string, isDark: boolean): string {
    switch (type) {
        case 'appdb':
            return isDark ? '#22c55e' : '#16a34a';
        case 'sub/run':
            return isDark ? '#3b82f6' : '#2563eb';
        case 'render':
            return isDark ? '#06b6d4' : '#0891b2';
        default:
            return isDark ? '#6b7280' : '#4b5563';
    }
}

export default function GraphView({ traces }: { traces: Trace[] }) {
    const { theme } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<any>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Track container dimensions changes
    useEffect(() => {
        if (!containerRef.current) return;

        const updateDimensions = () => {
            const { width, height } = containerRef.current!.getBoundingClientRect();
            setDimensions({ width, height });
        };

        // Initial measurement
        updateDimensions();

        // Use ResizeObserver to track size changes
        const resizeObserver = new ResizeObserver(updateDimensions);
        resizeObserver.observe(containerRef.current);

        return () => resizeObserver.disconnect();
    }, []);

    const graphData = useMemo(() => createGraphData(traces), [traces]);
    const isDark = theme === 'dark';
    const renderColor = getNodeColor('render', isDark);

    // Fix node position after drag so it stays where user placed it
    const handleNodeDragEnd = useCallback((node: any) => {
        node.fx = node.x;
        node.fy = node.y;
    }, []);

    if (graphData.nodes.length === 1 && graphData.links.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-base-content/60">
                <p>No graph data to display</p>
            </div>
        );
    }

    // Don't render graph until we have dimensions
    if (dimensions.width === 0 || dimensions.height === 0) {
        return <div ref={containerRef} className="w-full h-full" />;
    }

    return (
        <div ref={containerRef} className="w-full h-full">
            <ForceGraph2D
                ref={graphRef}
                graphData={graphData}
                width={dimensions.width}
                height={dimensions.height}
                nodeLabel="label"
                backgroundColor="transparent"
                enableNodeDrag={true}
                enableZoomInteraction={true}
                linkColor={(link: any) => link.leadsToRender ? renderColor : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)')}
                onNodeDragEnd={handleNodeDragEnd}
                nodeCanvasObject={(node: any, ctx: any, globalScale: any) => {
                    const label = node.label;
                    const fontSize = 14 / globalScale;
                    ctx.font = `${fontSize}px Sans-Serif`;
                    const textWidth = ctx.measureText(label).width;
                    const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.4);

                    ctx.fillStyle = isDark ? '#191e24' : 'rgba(255, 255, 255, 0.8)';
                    ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2, ...bckgDimensions);

                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = getNodeColor(node.type, isDark);
                    ctx.fillText(label, node.x, node.y);

                    node.__bckgDimensions = bckgDimensions;
                }}
                nodePointerAreaPaint={(node: any, color: any, ctx: any) => {
                    ctx.fillStyle = color;
                    const bckgDimensions = node.__bckgDimensions;
                    bckgDimensions && ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2, ...bckgDimensions);
                }}
            />
        </div>
    );
}
