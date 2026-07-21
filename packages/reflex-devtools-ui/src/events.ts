import { current } from "@flexsurfer/reflex";
import { applyPatches, enablePatches } from "immer";
import type { Badge, Trace, TraceItem } from './types/Trace';
import type { DevtoolsRuntimeSummary } from './types/Runtime';
import { regEvent } from './runtime';

// Enable Immer patches plugin for applyPatches functionality
enablePatches();

function clearRuntimeView(draftDb: any) {
    draftDb.db = "";
    draftDb.traces = [];
    draftDb.activeSubs = {};
    draftDb.handlerKeys = null;
    draftDb.handlerUsage = {};
    draftDb.selectedTrace = null;
    draftDb.dispatchModalOpenState = {};
}

function acceptsRuntimeMessage(draftDb: any, runtimeId: string, sessionEpoch: number) {
    if (
        runtimeId !== draftDb.selectedRuntimeId
        || draftDb.pendingRuntimeId !== null
        || !Number.isSafeInteger(sessionEpoch)
        || sessionEpoch < 1
        || sessionEpoch < draftDb.sessionEpoch
    ) {
        return false;
    }
    if (sessionEpoch > draftDb.sessionEpoch) {
        clearRuntimeView(draftDb);
        draftDb.sessionEpoch = sessionEpoch;
    }
    return true;
}

regEvent('set-runtimes', (
    { draftDb },
    runtimes: DevtoolsRuntimeSummary[],
    serverSelectedRuntimeId?: string | null,
) => {
    const previousRuntimeId = draftDb.selectedRuntimeId as string | null;
    const previousEpoch = draftDb.sessionEpoch as number;
    const pendingRuntimeId = draftDb.pendingRuntimeId as string | null;
    draftDb.runtimes = runtimes;

    if (pendingRuntimeId !== null) {
        const pending = runtimes.find(
            ({ runtimeId }) => runtimeId === pendingRuntimeId,
        );
        if (pending) {
            // Runtime-status messages are advisory while a selection request is
            // in flight. Only devtools-runtime-selected commits the server's
            // acknowledgement, so an older status cannot roll the UI back.
            if (
                draftDb.selectedRuntimeId === pending.runtimeId
                && draftDb.sessionEpoch !== pending.sessionEpoch
            ) {
                clearRuntimeView(draftDb);
                draftDb.sessionEpoch = pending.sessionEpoch;
            }
            return undefined;
        }

        // The requested runtime disappeared before acknowledgement. Reconcile
        // with the server list instead of leaving dispatch pinned to a ghost.
        draftDb.pendingRuntimeId = null;
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
        clearRuntimeView(draftDb);
        draftDb.selectedRuntimeId = nextRuntimeId;
        draftDb.sessionEpoch = nextEpoch;
    }

    if (nextRuntimeId && serverSelectedRuntimeId == null) {
        draftDb.pendingRuntimeId = nextRuntimeId;
        return [['send-runtime-selection', nextRuntimeId]];
    }
    return undefined;
});

regEvent('select-runtime', ({ draftDb }, runtimeId: string) => {
    const selected = (draftDb.runtimes as DevtoolsRuntimeSummary[])
        .find((runtime) => runtime.runtimeId === runtimeId);
    if (
        !selected
        || (
            selected.runtimeId === draftDb.selectedRuntimeId
            && draftDb.pendingRuntimeId === null
        )
        || selected.runtimeId === draftDb.pendingRuntimeId
    ) return;

    clearRuntimeView(draftDb);
    draftDb.selectedRuntimeId = selected.runtimeId;
    draftDb.pendingRuntimeId = selected.runtimeId;
    draftDb.sessionEpoch = selected.sessionEpoch;
    return [['send-runtime-selection', selected.runtimeId]];
});

regEvent('runtime-selected', (
    { draftDb },
    identity: { runtimeId: string; runtimeName: string; sessionEpoch: number },
) => {
    if (
        draftDb.pendingRuntimeId !== null
        && draftDb.pendingRuntimeId !== identity.runtimeId
    ) {
        return;
    }

    if (
        draftDb.selectedRuntimeId !== identity.runtimeId
        || draftDb.sessionEpoch !== identity.sessionEpoch
    ) {
        clearRuntimeView(draftDb);
    }
    draftDb.selectedRuntimeId = identity.runtimeId;
    draftDb.sessionEpoch = identity.sessionEpoch;
    draftDb.pendingRuntimeId = null;
});

regEvent('runtime-selection-rejected', (
    { draftDb },
    runtimes: DevtoolsRuntimeSummary[],
    serverSelectedRuntimeId: string | null,
) => {
    draftDb.pendingRuntimeId = null;
    draftDb.runtimes = runtimes;
    const selected = (
        typeof serverSelectedRuntimeId === 'string'
            ? runtimes.find(({ runtimeId }) => runtimeId === serverSelectedRuntimeId)
            : undefined
    )
        ?? runtimes.find(({ runtimeId }) => runtimeId === draftDb.selectedRuntimeId)
        ?? runtimes.find(({ connected }) => connected)
        ?? runtimes[0]
        ?? null;

    if (
        draftDb.selectedRuntimeId !== (selected?.runtimeId ?? null)
        || draftDb.sessionEpoch !== (selected?.sessionEpoch ?? 0)
    ) {
        clearRuntimeView(draftDb);
    }
    draftDb.selectedRuntimeId = selected?.runtimeId ?? null;
    draftDb.sessionEpoch = selected?.sessionEpoch ?? 0;

    if (selected && serverSelectedRuntimeId === null) {
        draftDb.pendingRuntimeId = selected.runtimeId;
        return [['send-runtime-selection', selected.runtimeId]];
    }
    return undefined;
});

regEvent('add-traces', ({ draftDb }, traces: Trace[], runtimeId: string, sessionEpoch: number) => {
    if (!acceptsRuntimeMessage(draftDb, runtimeId, sessionEpoch)) return;
    // Initialize handlerUsage if not exists
    if (!draftDb.handlerUsage) {
        draftDb.handlerUsage = {};
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
                if (!draftDb.handlerUsage[type]) {
                    draftDb.handlerUsage[type] = {};
                }
                if (!draftDb.handlerUsage[type][operation]) {
                    draftDb.handlerUsage[type][operation] = 0;
                }
                draftDb.handlerUsage[type][operation]++;
            });
        }
    });

    // Collect all patches from traces to apply to the client app DB
    const allPatches = traces
        .filter(trace => trace.tags?.patches?.length > 0)
        .flatMap(trace => trace.tags!.patches!);

    // Apply patches to the client app DB copy if we have patches
    if (allPatches.length > 0 && draftDb.db) {
        draftDb.db = applyPatches(draftDb.db, allPatches);
    }

    const { eventTraceItems, renderTraceItem, badgesMap } = traces.reduce((acc, trace) => {
        if (trace.opType === 'event') {
            const badges: Badge[] = [];
            if (trace.tags?.patches?.length > 0) {
                badges.push({ label: 'db', number: trace.tags!.patches!.length });
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

    draftDb.traces.push(...eventTraceItems, ...renderTraceItemUpdated);
});

regEvent('update-db', ({ draftDb }, db: any, runtimeId: string, sessionEpoch: number) => {
    if (!acceptsRuntimeMessage(draftDb, runtimeId, sessionEpoch)) return;
    draftDb.db = db;
});

regEvent('update-active-subs', ({ draftDb }, activeSubs: any, runtimeId: string, sessionEpoch: number) => {
    if (!acceptsRuntimeMessage(draftDb, runtimeId, sessionEpoch)) return;
    if (!draftDb.activeSubs) {
        draftDb.activeSubs = {};
    }

    for (const [key, value] of Object.entries(activeSubs)) {
        if (value === "reflex-tool-sub-disposed") {
            delete draftDb.activeSubs[key];
        } else {
            draftDb.activeSubs[key] = value;
        }
    }
});

regEvent('update-handler-keys', ({ draftDb }, handlerKeys: any, runtimeId: string, sessionEpoch: number) => {
    if (!acceptsRuntimeMessage(draftDb, runtimeId, sessionEpoch)) return;
    draftDb.handlerKeys = handlerKeys;
});

regEvent('clear-traces', ({ draftDb }) => {
    draftDb.traces = [];
    draftDb.selectedTrace = null;
    draftDb.handlerUsage = {};
});

regEvent('set-connected', ({ draftDb }, isConnected: boolean) => {
    draftDb.isConnected = isConnected;
});

regEvent('set-capabilities', ({ draftDb }, capabilities: string[]) => {
    draftDb.capabilities = capabilities;
    if (!capabilities.includes('dispatch')) {
        draftDb.dispatchModalOpenState = {};
    }
});

regEvent('set-filter', ({ draftDb }, filter: string) => {
    draftDb.filter = filter;
    draftDb.selectedTrace = null;
});

regEvent('toggle-show-renders', ({ draftDb }) => {
    draftDb.settings.showRenders = !draftDb.settings.showRenders;
    return [['save-settings', current(draftDb.settings)]];
});

regEvent('toggle-show-badges', ({ draftDb }) => {
    draftDb.settings.showBadges = !draftDb.settings.showBadges;
    return [['save-settings', current(draftDb.settings)]];
});

regEvent('toggle-show-params', ({ draftDb }) => {
    draftDb.settings.showParams = !draftDb.settings.showParams;
    return [['save-settings', current(draftDb.settings)]];
});

regEvent('toggle-show-timestamps', ({ draftDb }) => {
    draftDb.settings.showTimestamps = !draftDb.settings.showTimestamps;
    return [['save-settings', current(draftDb.settings)]];
});

regEvent('init-socket', () => {
    return [['init-socket']];
});

regEvent('set-selected-trace', ({ draftDb }, trace: TraceItem) => {
    draftDb.selectedTrace = trace;
});

regEvent('dispatch-to-client', ({ draftDb }, eventName: string, ...params: any[]) => {
    if (draftDb.pendingRuntimeId !== null || !draftDb.selectedRuntimeId) return;
    return [['send-dispatch-to-client', {
        runtimeId: draftDb.selectedRuntimeId,
        eventName,
        params
    }]];
});

regEvent('open-dispatch-modal', ({ draftDb }, eventName: string = 'event-id', initialParams: any[] = []) => {
    draftDb.dispatchModalOpenState = {
        isOpen: true,
        eventName,
        initialParams
    };
});

regEvent('close-dispatch-modal', ({ draftDb }) => {
    draftDb.dispatchModalOpenState = {
        isOpen: false,
        eventName: '',
        initialParams: []
    };
});
