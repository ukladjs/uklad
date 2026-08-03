import { useState, useEffect, useRef, useCallback } from 'react';
import type { ObjectViewHandle } from 'react-obj-view';
import { useObjViewSearch } from './useObjViewSearch';

interface SearchBoxProps {
    objViewRef: React.RefObject<ObjectViewHandle | undefined>;
}

export function SearchBox({ objViewRef }: SearchBoxProps) {
    const [isOpen, setIsOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const { inputValue, results, currentIndex, isSearching, setInputValue, navigateToResult, clearSearch } = useObjViewSearch(objViewRef);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
        }
    }, [isOpen]);

    const handleClose = useCallback(() => {
        setIsOpen(false);
        clearSearch();
    }, [clearSearch]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            handleClose();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            navigateToResult(e.shiftKey ? 'prev' : 'next');
        }
    }, [handleClose, navigateToResult]);

    // Collapsed state - just the search icon
    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="btn btn-xs btn-ghost btn-circle opacity-50 hover:opacity-100"
                title="Search"
            >
                <SearchIcon />
            </button>
        );
    }

    // Expanded state - full search UI
    return (
        <div className="flex items-center gap-1 bg-base-200 border border-base-300 rounded-lg shadow-lg px-2 py-1 w-80">
            <SearchIcon className="opacity-50 shrink-0" />
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search..."
                className="input input-xs input-ghost h-6 min-h-0 flex-1 px-1 focus:outline-none bg-transparent"
            />
            <SearchStatus
                isSearching={isSearching}
                resultsCount={results.length}
                currentIndex={currentIndex}
                hasQuery={inputValue.length > 0}
            />
            {results.length > 0 && (
                <NavigationButtons onNavigate={navigateToResult} />
            )}
            <button
                onClick={handleClose}
                className="btn btn-xs btn-ghost h-6 min-h-0 w-6 p-0 opacity-50 hover:opacity-100 shrink-0"
                title="Close (Esc)"
            >
                <CloseIcon />
            </button>
        </div>
    );
}

// Sub-components

function SearchStatus({
    isSearching,
    resultsCount,
    currentIndex,
    hasQuery,
}: {
    isSearching: boolean;
    resultsCount: number;
    currentIndex: number;
    hasQuery: boolean;
}) {
    return (
        <div className="w-16 flex justify-center">
            {isSearching ? (
                <span className="loading loading-spinner w-4 h-4 opacity-50" />
            ) : resultsCount > 0 ? (
                <span className="text-xs opacity-50 tabular-nums whitespace-nowrap">
                    {currentIndex + 1}/{resultsCount}
                </span>
            ) : hasQuery ? (
                <span className="text-xs opacity-50">No results</span>
            ) : null}
        </div>
    );
}

function NavigationButtons({
    onNavigate,
}: {
    onNavigate: (direction: 'next' | 'prev') => void;
}) {
    return (
        <>
            <button
                onClick={() => onNavigate('prev')}
                className="btn btn-xs btn-ghost h-6 min-h-0 w-6 p-0"
                title="Previous (Shift+Enter)"
            >
                <ChevronUpIcon />
            </button>
            <button
                onClick={() => onNavigate('next')}
                className="btn btn-xs btn-ghost h-6 min-h-0 w-6 p-0"
                title="Next (Enter)"
            >
                <ChevronDownIcon />
            </button>
        </>
    );
}

// Icons

function SearchIcon({ className = '' }: { className?: string }) {
    return (
        <svg className={`w-4 h-4 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
        </svg>
    );
}

function ChevronUpIcon() {
    return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m18 15-6-6-6 6" />
        </svg>
    );
}

function ChevronDownIcon() {
    return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" />
        </svg>
    );
}
