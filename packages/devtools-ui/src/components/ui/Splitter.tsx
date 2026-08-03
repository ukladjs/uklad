import { useEffect, useRef } from 'react';

export default function Splitter({ orientation = 'horizontal' }: { orientation?: 'horizontal' | 'vertical' }) {
    const splitterRef = useRef<HTMLDivElement>(null);

    const isVertical = orientation === 'vertical';

    useEffect(() => {
        const splitter = splitterRef.current;
        if (!splitter) return;

        let isDragging = false;
        let startPos = 0;
        let startSplitPosition = 0;
        const positionVar = isVertical ? '--vertical-split-position' : '--split-position';
        const containerSelector = isVertical ? '.vertical-split-layout' : '.split-layout';
        const resizeCursor = isVertical ? 'row-resize' : 'col-resize';

        const handleMouseDown = (e: MouseEvent) => {
            isDragging = true;
            startPos = isVertical ? e.clientY : e.clientX;

            // Get current split position from CSS variable
            const splitContainer = splitter.closest(containerSelector) as HTMLElement;
            if (splitContainer) {
                const currentPos = getComputedStyle(splitContainer).getPropertyValue(positionVar).trim();
                startSplitPosition = parseFloat(currentPos) || startSplitPosition;
            }

            splitter.classList.add('dragging');
            document.body.style.cursor = resizeCursor;
            document.body.style.userSelect = 'none';

            e.preventDefault();
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

            const splitContainer = splitter.closest(containerSelector) as HTMLElement;
            if (!splitContainer) return;

            const containerRect = splitContainer.getBoundingClientRect();
            const delta = isVertical ? (e.clientY - startPos) : (e.clientX - startPos);
            const dimension = isVertical ? containerRect.height : containerRect.width;
            const deltaPercent = (delta / dimension) * 100;
            const newPosition = Math.max(10, Math.min(90, startSplitPosition + deltaPercent));

            // Update CSS variable
            splitContainer.style.setProperty(positionVar, `${newPosition}%`);
        };

        const handleMouseUp = () => {
            if (!isDragging) return;

            isDragging = false;
            splitter.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        // Add event listeners
        splitter.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // Cleanup
        return () => {
            splitter.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isVertical]);

    return (
        <div
            ref={splitterRef}
            className={`
                bg-base-300 hover:bg-base-content/20 active:bg-base-content/30
                transition-colors select-none flex-shrink-0
                ${isVertical 
                    ? 'h-1 w-full cursor-row-resize' 
                    : 'w-1 h-full cursor-col-resize'
                }
                dragging:bg-base-content/40
            `}
        />
    );
} 