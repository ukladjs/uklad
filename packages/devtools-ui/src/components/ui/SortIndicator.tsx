interface SortIndicatorProps {
    direction: 'asc' | 'desc';
    className?: string;
}

export default function SortIndicator({ direction, className = "" }: SortIndicatorProps) {
    const iconClass = `w-6 h-6 inline-block ${className}`;

    if (direction === 'asc') {
        return (
            <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
                <path d="M7 14l5-5 5 5z"/>
            </svg>
        );
    }

    return (
        <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
            <path d="M7 10l5 5 5-5z"/>
        </svg>
    );
}
