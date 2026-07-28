import type { TraceItem } from "./types/Trace";
import { regRootSub, regSub } from './runtime';

// Subscriptions for devtools state
regRootSub('state', 'state');
regRootSub('activeSubs', 'activeSubs');
regRootSub('handlerKeys', 'handlerKeys');
regRootSub('handlerUsage', 'handlerUsage');
regRootSub('traces', 'traces');
regRootSub('isConnected', 'isConnected');
regRootSub('capabilities', 'capabilities');
regRootSub('runtimes', 'runtimes');
regRootSub('selectedRuntimeId', 'selectedRuntimeId');
regRootSub('pendingRuntimeId', 'pendingRuntimeId');
regRootSub('sessionEpoch', 'sessionEpoch');
regRootSub('filter', 'filter');
regRootSub('splitPosition', 'splitPosition');
regRootSub('isDragging', 'isDragging');
regRootSub('selectedTrace', 'selectedTrace');
regRootSub('settings', 'settings');
// Dispatch modal state
regRootSub('dispatchModalOpenState', 'dispatchModalOpenState');

// Settings
regSub('showRenders', () => [['settings']], ([settings]) => settings.showRenders);
regSub('showBadges', () => [['settings']], ([settings]) => settings.showBadges);
regSub('showParams', () => [['settings']], ([settings]) => settings.showParams);
regSub('showTimestamps', () => [['settings']], ([settings]) => settings.showTimestamps);

// Filtered traces - filter by text and toggle visibility of render traces
regSub('filteredTraces', () => [['traces'], ['filter'], ['showRenders']], ([traces, filter, showRenders]) => {
    const hasTextFilter = filter && filter.trim() !== '';
    const filterLower = hasTextFilter ? filter.toLowerCase().trim() : '';

    return traces.filter((trace: TraceItem) => {
        // If showRenders is true, hide render traces
        if (!showRenders && trace.type === 'render') {
            return false;
        }

        // For render traces, include them if not hiding
        if (trace.type === 'render') {
            return true;
        }

        // For event traces, apply text filter if present
        if (trace.type === 'event') {
            if (!hasTextFilter) {
                return true; // Show all events when no text filter
            }

            const eventContent = trace.traces[0]?.operation;
            if (eventContent) {
                return eventContent.toLowerCase().includes(filterLower);
            }
            return false;
        }

        return false;
    });
});
