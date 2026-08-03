import { current } from "@flexsurfer/reflex";
import { applyPatches, enablePatches } from "immer";
import type { Badge, Trace, TraceItem } from './types/Trace';
import type { DevtoolsRuntimeSummary } from './types/Runtime';
import { regEvent } from './runtime';

// Enable Immer patches plugin for applyPatches functionality
enablePatches();

function clearRuntimeView(draftState: any) {
    draftState.state = "";
    draftState.traces = [];
    draftState.activeSubs = {};
    draftState.handlerKeys = null;
    draftState.handlerUsage = {};
    draftState.selectedTrace = null;
    draftState.dispatchModalOpenState = {};
}

function acceptsRuntimeMessage(draftState: any, runtimeId: string, sessionEpoch: number) {
    if (
        runtimeId !== draftState.selectedRuntimeId
        || draftState.pendingRuntimeId !== null
        || !Number.isSafeInteger(sessionEpoch)
        || sessionEpoch < 1
        || sessionEpoch < draftState.sessionEpoch
    ) {
        return false;
    }
    if (sessionEpoch > draftState.sessionEpoch) {
        clearRuntimeView(draftState);
        draftState.sessionEpoch = sessionEpoch;
    }
    return true;
}

regEvent('set-runtimes', (
    { draftState },
    runtimes: DevtoolsRuntimeSummary[],
    serverSelectedRuntimeId?: string | null,
) => {
    const previousRuntimeId = draftState.selectedRuntimeId as string | null;
    const previousEpoch = draftState.sessionEpoch as number;
    const pendingRuntimeId = draftState.pendingRuntimeId as string | null;
    draftState.runtimes = runtimes;

    if (pendingRuntimeId !== null) {
        const pending = runtimes.find(
            ({ runtimeId }) => runtimeId === pendingRuntimeId,
        );
        if (pending) {
            // Runtime-status messages are advisory while a selection request is
            // in flight. Only devtools-runtime-selected commits the server's
            // acknowledgement, so an older status cannot roll the UI back.
            if (
                draftState.selectedRuntimeId === pending.runtimeId
                && draftState.sessionEpoch !== pending.sessionEpoch
            ) {
                clearRuntimeView(draftState);
                draftState.sessionEpoch = pending.sessionEpoch;
            }
            return undefined;
        }

        // The requested runtime disappeared before acknowledgement. Reconcile
        // with the server list instead of leaving dispatch pinned to a ghost.
        draftState.pendingRuntimeId = null;
    }

    const selected = (
        typeof serverSelectedRuntimeId === 'string'
            ? runtimes.find(({ runtimeId }) => runtimeId === serverSelectedRuntimeId)
            : undefined
    )
        ?? runtimes.find(({ runtimeId }) => runtimeId === previousRuntimeId)
        ?? runtimes.find(({ connected }) => connected)
        ?? runtimes[0]
        ?? null;
    const nextRuntimeId = selected?.runtimeId ?? null;
    const nextEpoch = selected?.sessionEpoch ?? 0;
    const selectionChanged = previousRuntimeId !== nextRuntimeId;
    if (selectionChanged || previousEpoch !== nextEpoch) {
        clearRuntimeView(draftState);
        draftState.selectedRuntimeId = nextRuntimeId;
        draftState.sessionEpoch = nextEpoch;
    }

    if (nextRuntimeId && serverSelectedRuntimeId == null) {
        draftState.pendingRuntimeId = nextRuntimeId;
        return [['send-runtime-selection', nextRuntimeId]];
    }
    return undefined;
});

regEvent('select-runtime', ({ draftState }, runtimeId: string) => {
    const selected = (draftState.runtimes as DevtoolsRuntimeSummary[])
        .find((runtime) => runtime.runtimeId === runtimeId);
    if (
        !selected
        || (
            selected.runtimeId === draftState.selectedRuntimeId
            && draftState.pendingRuntimeId === null
        )
        || selected.runtimeId === draftState.pendingRuntimeId
    ) return;

    clearRuntimeView(draftState);
    draftState.selectedRuntimeId = selected.runtimeId;
    draftState.pendingRuntimeId = selected.runtimeId;
    draftState.sessionEpoch = selected.sessionEpoch;
    return [['send-runtime-selection', selected.runtimeId]];
});

regEvent('runtime-selected', (
    { draftState },
    identity: { runtimeId: string; runtimeName: string; sessionEpoch: number },
) => {
    if (
        draftState.pendingRuntimeId !== null
        && draftState.pendingRuntimeId !== identity.runtimeId
    ) {
        return;
    }

    if (
        draftState.selectedRuntimeId !== identity.runtimeId
        || draftState.sessionEpoch !== identity.sessionEpoch
    ) {
        clearRuntimeView(draftState);
    }
    draftState.selectedRuntimeId = identity.runtimeId;
    draftState.sessionEpoch = identity.sessionEpoch;
    draftState.pendingRuntimeId = null;
});

regEvent('runtime-selection-rejected', (
    { draftState },
    runtimes: DevtoolsRuntimeSummary[],
    serverSelectedRuntimeId: string | null,
) => {
    draftState.pendingRuntimeId = null;
    draftState.runtimes = runtimes;
    const selected = (
        typeof serverSelectedRuntimeId === 'string'
            ? runtimes.find(({ runtimeId }) => runtimeId === serverSelectedRuntimeId)
            : undefined
    )
        ?? runtimes.find(({ runtimeId }) => runtimeId === draftState.selectedRuntimeId)
        ?? runtimes.find(({ connected }) => connected)
        ?? runtimes[0]
        ?? null;

    if (
        draftState.selectedRuntimeId !== (selected?.runtimeId ?? null)
        || draftState.sessionEpoch !== (selected?.sessionEpoch ?? 0)
    ) {
        clearRuntimeView(draftState);
    }
    draftState.selectedRuntimeId = selected?.runtimeId ?? null;
    draftState.sessionEpoch = selected?.sessionEpoch ?? 0;

    if (selected && serverSelectedRuntimeId === null) {
        draftState.pendingRuntimeId = selected.runtimeId;
        return [['send-runtime-selection', selected.runtimeId]];
    }
    return undefined;
});

regEvent('add-traces', ({ draftState }, traces: Trace[], runtimeId: string, sessionEpoch: number) => {
    if (!acceptsRuntimeMessage(draftState, runtimeId, sessionEpoch)) return;
    // Initialize handlerUsage if not exists
    if (!draftState.handlerUsage) {
        draftState.handlerUsage = {};
    }

    // Track handler executions
    traces.forEach(trace => {
        const opType = trace.opType;
        const operation = trace.operation;

        if (opType) {
            // Track different handler types based on opType and tags
            const handlerOperations: Array<{ type: string; operation: string }> = [];

            if (opType === 'event') {
                // For events, track the event itself and any effects/coeffects in tags
                // Always track the event
                if (operation) {
                    handlerOperations.push({ type: 'event', operation });
                }

                // Track effects if present
                if (trace.tags?.effects?.length > 0) {
                    trace.tags!.effects.forEach(([effectName]: [string, number]) => {
                        handlerOperations.push({ type: 'fx', operation: effectName });
                    });
                }

                // Track coeffects if present
                if (trace.tags?.coeffects?.length > 0) {
                    trace.tags!.coeffects.forEach(([cofxName]: [string, number]) => {
                        handlerOperations.push({ type: 'cofx', operation: cofxName });
                    });
                }
            } else {
                // For non-event traces, determine handler type and operations
                let handlerType: string | null = null;

                if (opType === 'sub/run') {
                    handlerType = 'sub';
                }

                if (handlerType && operation) {
                    handlerOperations.push({ type: handlerType, operation });
                }
            }

            // Apply all handler operations
            handlerOperations.forEach(({ type, operation }) => {
                if (!draftState.handlerUsage[type]) {
                    draftState.handlerUsage[type] = {};
                }
                if (!draftState.handlerUsage[type][operation]) {
                    draftState.handlerUsage[type][operation] = 0;
                }
                draftState.handlerUsage[type][operation]++;
            });
        }
    });

    // Collect all patches from traces to apply to the client app STATE
    const allPatches = traces
        .filter(trace => trace.tags?.patches?.length > 0)
        .flatMap(trace => trace.tags!.patches!);

    // Apply patches to the client app STATE copy if we have patches
    if (allPatches.length > 0 && draftState.state) {
        draftState.state = applyPatches(draftState.state, allPatches);
    }

    const { eventTraceItems, renderTraceItem, badgesMap } = traces.reduce((acc, trace) => {
        if (trace.opType === 'event') {
            const badges: Badge[] = [];
            if (trace.tags?.patches?.length > 0) {
                badges.push({ label: 'state', number: trace.tags!.patches!.length });
            }
            if (trace.tags?.effects?.length > 0) {
                badges.push({ label: 'fx', number: trace.tags!.effects!.length });
            }
            acc.eventTraceItems.push({
                id: trace.id,
                type: 'event',
                badges: badges,
                traces: [trace]
            });
        } else {
            const op = trace.opType ?? '';
            acc.badgesMap.set(op, (acc.badgesMap.get(op) || 0) + 1);
            acc.renderTraceItem.traces.push(trace);
        }
        return acc;
    }, { eventTraceItems: [] as TraceItem[], renderTraceItem: { type: 'render', traces: [] as Trace[], badges: [] as Badge[] } as TraceItem, badgesMap: new Map<string, number>() });

    const getPriority = (opType: string | undefined) => {
        if (opType === 'render') return 0;
        if (opType === 'sub/create') return 1;
        if (opType === 'sub/run') return 2;
        if (opType === 'sub/dispose') return 3;
        return 4;
    };

    const sortedRenderTraces = renderTraceItem.traces.sort((a, b) => {
        return getPriority(a.opType) - getPriority(b.opType);
    });

    renderTraceItem.traces = sortedRenderTraces;

    renderTraceItem.badges = Array.from(badgesMap.entries())
        .sort((a, b) => getPriority(a[0]) - getPriority(b[0]))
        .map(([label, number]) => ({ label, number }));

    const renderTraceItemUpdated = renderTraceItem.traces.length > 0 ? [{ ...renderTraceItem, id: renderTraceItem.traces[0].id }] : [];

    draftState.traces.push(...eventTraceItems, ...renderTraceItemUpdated);
});

regEvent('update-state', ({ draftState }, state: any, runtimeId: string, sessionEpoch: number) => {
    if (!acceptsRuntimeMessage(draftState, runtimeId, sessionEpoch)) return;
    draftState.state = state;
});

regEvent('update-active-subs', ({ draftState }, activeSubs: any, runtimeId: string, sessionEpoch: number) => {
    if (!acceptsRuntimeMessage(draftState, runtimeId, sessionEpoch)) return;
    if (!draftState.activeSubs) {
        draftState.activeSubs = {};
    }

    for (const [key, value] of Object.entries(activeSubs)) {
        if (value === "reflex-tool-sub-disposed") {
            delete draftState.activeSubs[key];
        } else {
            draftState.activeSubs[key] = value;
        }
    }
});

regEvent('update-handler-keys', ({ draftState }, handlerKeys: any, runtimeId: string, sessionEpoch: number) => {
    if (!acceptsRuntimeMessage(draftState, runtimeId, sessionEpoch)) return;
    draftState.handlerKeys = handlerKeys;
});

regEvent('clear-traces', ({ draftState }) => {
    draftState.traces = [];
    draftState.selectedTrace = null;
    draftState.handlerUsage = {};
});

regEvent('set-connected', ({ draftState }, isConnected: boolean) => {
    draftState.isConnected = isConnected;
});

regEvent('set-capabilities', ({ draftState }, capabilities: string[]) => {
    draftState.capabilities = capabilities;
    if (!capabilities.includes('dispatch')) {
        draftState.dispatchModalOpenState = {};
    }
});

regEvent('set-filter', ({ draftState }, filter: string) => {
    draftState.filter = filter;
    draftState.selectedTrace = null;
});

regEvent('toggle-show-renders', ({ draftState }) => {
    draftState.settings.showRenders = !draftState.settings.showRenders;
    return [['save-settings', current(draftState.settings)]];
});

regEvent('toggle-show-badges', ({ draftState }) => {
    draftState.settings.showBadges = !draftState.settings.showBadges;
    return [['save-settings', current(draftState.settings)]];
});

regEvent('toggle-show-params', ({ draftState }) => {
    draftState.settings.showParams = !draftState.settings.showParams;
    return [['save-settings', current(draftState.settings)]];
});

regEvent('toggle-show-timestamps', ({ draftState }) => {
    draftState.settings.showTimestamps = !draftState.settings.showTimestamps;
    return [['save-settings', current(draftState.settings)]];
});

regEvent('init-socket', () => {
    return [['init-socket']];
});

regEvent('set-selected-trace', ({ draftState }, trace: TraceItem) => {
    draftState.selectedTrace = trace;
});

regEvent('dispatch-to-client', ({ draftState }, eventName: string, ...params: any[]) => {
    if (draftState.pendingRuntimeId !== null || !draftState.selectedRuntimeId) return;
    return [['send-dispatch-to-client', {
        runtimeId: draftState.selectedRuntimeId,
        eventName,
        params
    }]];
});

regEvent('open-dispatch-modal', ({ draftState }, eventName: string = 'event-id', initialParams: any[] = []) => {
    draftState.dispatchModalOpenState = {
        isOpen: true,
        eventName,
        initialParams
    };
});

regEvent('close-dispatch-modal', ({ draftState }) => {
    draftState.dispatchModalOpenState = {
        isOpen: false,
        eventName: '',
        initialParams: []
    };
});
