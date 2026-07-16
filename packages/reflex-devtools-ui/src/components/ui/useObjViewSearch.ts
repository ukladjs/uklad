import { useState, useRef, useCallback, useEffect } from 'react';
import type { ObjectViewHandle } from 'react-obj-view';

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a search filter function for react-obj-view
 * Matches against both keys and primitive values (string, number, boolean)
 */
function createSearchFilter(searchTerm: string): (value: unknown, key: PropertyKey) => boolean {
  const lowerTerm = searchTerm.toLowerCase();

  return (value: unknown, key: PropertyKey): boolean => {
    // Check key match
    if (String(key).toLowerCase().includes(lowerTerm)) {
      return true;
    }

    // Check value match for primitives
    if (typeof value === 'string') {
      return value.toLowerCase().includes(lowerTerm);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value).toLowerCase().includes(lowerTerm);
    }

    return false;
  };
}

/**
 * Create a regex for highlighting search matches
 */
function createHighlightRegex(searchTerm: string): RegExp {
  return new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
}

interface SearchState {
  inputValue: string;
  results: PropertyKey[][];
  currentIndex: number;
  isSearching: boolean;
}

interface UseObjViewSearchReturn extends SearchState {
  setInputValue: (value: string) => void;
  navigateToResult: (direction: 'next' | 'prev') => void;
  clearSearch: () => void;
}

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 1000;
const MAX_DEPTH = 50;
const BATCH_UPDATE_MS = 100;

export function useObjViewSearch(objViewRef: React.RefObject<ObjectViewHandle | undefined>): UseObjViewSearchReturn {
  const [state, setState] = useState<SearchState>({
    inputValue: '',
    results: [],
    currentIndex: 0,
    isSearching: false,
  });

  // Track current search session to ignore stale callbacks
  const searchSessionRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const batchTimeoutRef = useRef<number | null>(null);

  // Run search when input changes (debounced)
  useEffect(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    const query = state.inputValue.trim();

    // Clear results and highlights if query is empty
    if (!query) {
      searchSessionRef.current++;
      // Clear highlights in ObjectView
      objViewRef.current?.search(undefined, undefined, () => {}, { maxResult: 0 });
      setState(prev => ({ ...prev, results: [], currentIndex: 0, isSearching: false }));
      return;
    }

    // Set searching state immediately for UI feedback
    setState(prev => ({ ...prev, isSearching: true }));

    debounceRef.current = window.setTimeout(() => {
      // Increment session to invalidate any pending callbacks
      const currentSession = ++searchSessionRef.current;
      const collectedResults: PropertyKey[][] = [];
      const seen = new Set<string>();

      // Low-cost deduplication function
      const addPaths = (paths: PropertyKey[][]) => {
        for (const p of paths) {
          const key = p.map(String).join('\u0000');
          if (!seen.has(key)) {
            seen.add(key);
            collectedResults.push(p);
          }
        }
      };

      // Clear any existing batch timeout from previous search
      if (batchTimeoutRef.current !== null) {
        clearTimeout(batchTimeoutRef.current);
        batchTimeoutRef.current = null;
      }

      const flushResults = () => {
        if (searchSessionRef.current !== currentSession) return;
        setState(prev => ({
          ...prev,
          results: [...collectedResults],
        }));
      };

      const filterFn = createSearchFilter(query);
      const highlightRegex = createHighlightRegex(query);

      const searchPromise = objViewRef.current?.search(
        filterFn,
        highlightRegex,
        (paths: PropertyKey[][]) => {
          // Ignore if this search was superseded
          if (searchSessionRef.current !== currentSession) return;

          if (paths.length > 0) {
            // Add all matching paths from this callback (with deduplication)
            addPaths(paths);

            // Batch updates: only update state every BATCH_UPDATE_MS
            if (batchTimeoutRef.current === null) {
              batchTimeoutRef.current = window.setTimeout(() => {
                batchTimeoutRef.current = null;
                flushResults();
              }, BATCH_UPDATE_MS);
            }
          }
        },
        {
          maxResult: MAX_RESULTS,
          fullSearch: true,
          maxDepth: MAX_DEPTH,
        }
      );

      const handleSearchComplete = () => {
        if (searchSessionRef.current !== currentSession) return;

        // Clear any pending batch timeout and do final flush
        if (batchTimeoutRef.current !== null) {
          clearTimeout(batchTimeoutRef.current);
          batchTimeoutRef.current = null;
        }

        const newResults = [...collectedResults];
        const hasResults = newResults.length > 0;

        setState(prev => ({
          ...prev,
          results: newResults,
          currentIndex: 0,
          isSearching: false,
        }));

        // Auto-navigate to first result if we have results
        if (hasResults && newResults[0]) {
          objViewRef.current?.scrollToPaths(newResults[0], { behavior: 'smooth' });
        }
      };

      const handleSearchError = () => {
        if (searchSessionRef.current !== currentSession) return;

        // Clear any pending batch timeout
        if (batchTimeoutRef.current !== null) {
          clearTimeout(batchTimeoutRef.current);
          batchTimeoutRef.current = null;
        }

        setState(prev => ({
          ...prev,
          results: [],
          currentIndex: 0,
          isSearching: false,
        }));
      };

      searchPromise?.then(handleSearchComplete).catch(handleSearchError);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
      if (batchTimeoutRef.current !== null) {
        clearTimeout(batchTimeoutRef.current);
      }
    };
  }, [state.inputValue, objViewRef]);

  // Scroll to current result when currentIndex changes
  useEffect(() => {
    if (state.results.length > 0 && state.currentIndex >= 0 && state.currentIndex < state.results.length) {
      const path = state.results[state.currentIndex];
      if (path) {
        objViewRef.current?.scrollToPaths(path, { behavior: 'smooth' });
      }
    }
  }, [state.currentIndex, state.results, objViewRef]);

  const setInputValue = useCallback((value: string) => {
    setState(prev => ({ ...prev, inputValue: value }));
  }, []);
  
  const navigateToResult = useCallback((direction: 'next' | 'prev') => {
    setState(prev => {
      if (prev.results.length === 0) return prev;

      const delta = direction === 'next' ? 1 : -1;
      const newIndex = ((prev.currentIndex + delta) % prev.results.length + prev.results.length) % prev.results.length;

      return { ...prev, currentIndex: newIndex };
    });
  }, []);

  const clearSearch = useCallback(() => {
    searchSessionRef.current++;
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    if (batchTimeoutRef.current !== null) {
      clearTimeout(batchTimeoutRef.current);
      batchTimeoutRef.current = null;
    }
    // Clear highlights in ObjectView
    objViewRef.current?.search(undefined, undefined, () => {}, { maxResult: 0 });
    setState({
      inputValue: '',
      results: [],
      currentIndex: 0,
      isSearching: false,
    });
  }, [objViewRef]);

  return {
    ...state,
    setInputValue,
    navigateToResult,
    clearSearch,
  };
}

