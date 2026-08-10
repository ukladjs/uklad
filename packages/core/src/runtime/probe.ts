import { consoleLog } from '../core/logging';

import type { RuntimeCore } from './core';
import type { EventVector } from '../types';
import type {
  RuntimeProbe,
  RuntimeProbeAttachment,
  RuntimeProbeEventMetadata,
  RuntimeProbeParent,
  RuntimeProbeSpan,
  RuntimeProbeSubscription,
  RuntimeSpanContext,
  RuntimeTrackingContext,
  RuntimeTrackingEntry,
} from './probe-types';

export type {
  RuntimeProbe,
  RuntimeProbeCommit,
  RuntimeProbeEffect,
  RuntimeProbeEventMetadata,
  RuntimeProbeParent,
  RuntimeProbePatch,
  RuntimeProbeSpan,
  RuntimeProbeSubscription,
  RuntimeProbeTransition,
  RuntimeTrackingContext,
} from './probe-types';

const ATTACHMENTS = new WeakMap<RuntimeCore, Set<RuntimeProbeAttachment>>();
const NEXT_EVENT_INSTANCE_ID = new WeakMap<RuntimeCore, number>();

/** Read the opaque token contributed by one probe to a tracking context. */
export function getRuntimeTrackingToken(
  tracking: RuntimeTrackingContext | undefined,
  probe: RuntimeProbe,
): unknown {
  return tracking?.entries.find((entry) => entry.attachment.probe === probe)?.token;
}

/** Attach one capability and restore the uninstrumented path on final disposal. */
export function attachRuntimeProbe(runtime: RuntimeCore, probe: RuntimeProbe): () => void {
  const attachment: RuntimeProbeAttachment = { probe, active: true };
  const attachments = ATTACHMENTS.get(runtime) ?? new Set<RuntimeProbeAttachment>();
  attachments.add(attachment);
  ATTACHMENTS.set(runtime, attachments);
  refreshProbeSlot(runtime, attachments);

  return () => {
    if (!attachment.active) return;
    attachment.active = false;
    attachments.delete(attachment);
    refreshProbeSlot(runtime, attachments);
  };
}

/** Accept optional tracking without allowing instrumentation failure to block dispatch. */
export function acceptRuntimeEvent(
  runtime: RuntimeCore,
  event: EventVector,
  parent?: RuntimeProbeParent,
): RuntimeTrackingContext | undefined {
  const probe = runtime.probe;
  if (!probe?.eventAccepted) return undefined;
  return probe.eventAccepted(
    event,
    parent,
    createRuntimeProbeEventMetadata(runtime, parent),
  ) as RuntimeTrackingContext | undefined;
}

/** Notify only the probes that accepted this exact event occurrence. */
export function notifyTrackedRuntimeEvent(
  tracking: RuntimeTrackingContext | undefined,
  method: 'eventQueued' | 'eventStarted' | 'transition' | 'committed' | 'effect' | 'eventFinished',
  ...args: readonly unknown[]
): void {
  if (!tracking) return;
  for (const entry of tracking.entries) {
    if (!entry.attachment.active) continue;
    invokeProbe(entry.attachment.probe, method, entry.token, ...args);
  }
}

/** Return whether any accepting probe consumes one tracked callback. */
export function hasTrackedRuntimeEventCallback(
  tracking: RuntimeTrackingContext | undefined,
  method: 'effect',
): boolean {
  return (
    tracking?.entries.some(
      (entry) => entry.attachment.active && typeof entry.attachment.probe[method] === 'function',
    ) ?? false
  );
}

/** Notify attached probes of facts that are not scoped to one event token. */
export function notifyRuntimeProbe(
  runtime: RuntimeCore,
  method: 'error' | 'stateCommitted' | 'published' | 'runtimeDisposed',
  ...args: readonly unknown[]
): void {
  const probe = runtime.probe;
  if (!probe) return;
  invokeProbe(probe, method, ...args);
}

/** Report queue drops to the probes that own the dropped tracking tokens. */
export function notifyDroppedRuntimeEvents(
  contexts: readonly RuntimeTrackingContext[],
  reason: 'queue-dropped' | 'disposed',
  error: unknown,
): void {
  const tokensByAttachment = new Map<RuntimeProbeAttachment, unknown[]>();
  for (const context of contexts) {
    for (const entry of context.entries) {
      if (!entry.attachment.active) continue;
      const tokens = tokensByAttachment.get(entry.attachment) ?? [];
      tokens.push(entry.token);
      tokensByAttachment.set(entry.attachment, tokens);
    }
  }
  for (const [attachment, tokens] of tokensByAttachment) {
    invokeProbe(attachment.probe, 'eventsDropped', Object.freeze(tokens), reason, error);
  }
}

/** Run work inside optional span callbacks without constructing facts when disabled. */
export function withRuntimeProbeSpan<T>(
  runtime: RuntimeCore,
  createSpan: () => RuntimeProbeSpan,
  fn: () => T,
): T {
  const probe = runtime.probe;
  if (!probe?.needsSpans || !probe.spanStarted) return fn();
  const span = createSpan();
  const context = probe.spanStarted(span) as RuntimeSpanContext | undefined;
  try {
    return fn();
  } finally {
    if (context !== undefined) probe.spanFinished?.(context);
  }
}

/** Merge facts into the active span of probes that support span enrichment. */
export function mergeRuntimeProbeSpan(
  runtime: RuntimeCore,
  createTags: () => Readonly<Record<string, unknown>>,
): void {
  const probe = runtime.probe;
  if (!probe?.needsSpans || !probe.spanFinished) return;
  probe.spanFinished(undefined, { tags: createTags() });
}

/** Release every optional capability owned by a terminal runtime. */
export function detachRuntimeProbes(runtime: RuntimeCore): void {
  const attachments = ATTACHMENTS.get(runtime);
  if (attachments) {
    for (const attachment of attachments) attachment.active = false;
    attachments.clear();
    ATTACHMENTS.delete(runtime);
  }
  runtime.probe = undefined;
}

function refreshProbeSlot(
  runtime: RuntimeCore,
  attachments: ReadonlySet<RuntimeProbeAttachment>,
): void {
  const active = [...attachments].filter((attachment) => attachment.active);
  runtime.probe = active.length === 0 ? undefined : createCompositeProbe(active);
}

function createCompositeProbe(attachments: readonly RuntimeProbeAttachment[]): RuntimeProbe {
  const probes = attachments.map((attachment) => attachment.probe);
  return Object.freeze({
    needsPatches: probes.some((probe) => probe.needsPatches),
    needsSubscriptionEvidence: probes.some((probe) => probe.needsSubscriptionEvidence),
    needsSpans: probes.some((probe) => probe.needsSpans),
    tracksOperations: probes.some((probe) => probe.tracksOperations === true),

    eventAccepted(
      event: EventVector,
      parent?: RuntimeProbeParent,
      metadata?: RuntimeProbeEventMetadata,
    ): RuntimeTrackingContext | undefined {
      if (!metadata) return undefined;
      const entries: RuntimeTrackingEntry[] = [];
      let operationTracked = false;
      for (const attachment of attachments) {
        const callback = attachment.probe.eventAccepted;
        if (!attachment.active || !callback) continue;
        const parentEntry = parent?.tracking.entries.find(
          (entry) => entry.attachment === attachment,
        );
        const probeParent =
          parentEntry === undefined
              ? undefined
              : {
                tracking: {
                  eventMetadata: parent.tracking.eventMetadata,
                  operationTracked: attachment.probe.tracksOperations === true,
                  entries: [{ attachment, token: parentEntry.token }],
                },
                ...(parent?.sourceEffectId === undefined
                  ? {}
                  : { sourceEffectId: parent.sourceEffectId }),
                ...(parent?.sourceEffectIndex === undefined
                  ? {}
                  : { sourceEffectIndex: parent.sourceEffectIndex }),
              };
        try {
          const token = callback.call(attachment.probe, event, probeParent, metadata);
          entries.push({ attachment, token });
          operationTracked ||= attachment.probe.tracksOperations === true;
        } catch (error) {
          consoleLog('warn', '[uklad] runtime probe failed during eventAccepted.', error);
        }
      }
      return entries.length === 0
        ? undefined
        : Object.freeze({
            eventMetadata: metadata,
            operationTracked,
            entries: Object.freeze(entries),
          });
    },

    stateCommitted(previousState: unknown, nextState: unknown, revision: number): void {
      fanOut(attachments, 'stateCommitted', previousState, nextState, revision);
    },
    published(
      state: unknown,
      revision: number,
      subscriptions?: readonly RuntimeProbeSubscription[],
    ): void {
      fanOut(attachments, 'published', state, revision, subscriptions);
    },
    runtimeDisposed(error: unknown): void {
      fanOut(attachments, 'runtimeDisposed', error);
    },
    error(kind: string, error: unknown): void {
      fanOut(attachments, 'error', kind, error);
    },
    spanStarted(span: RuntimeProbeSpan): RuntimeSpanContext | undefined {
      const entries: RuntimeTrackingEntry[] = [];
      for (const attachment of attachments) {
        if (!attachment.active || !attachment.probe.needsSpans) continue;
        const callback = attachment.probe.spanStarted;
        if (!callback) continue;
        try {
          entries.push({
            attachment,
            token: callback.call(attachment.probe, span),
          });
        } catch (error) {
          consoleLog('warn', '[uklad] runtime probe failed during spanStarted.', error);
        }
      }
      return entries.length === 0 ? undefined : { entries };
    },
    spanFinished(token: unknown, span?: RuntimeProbeSpan): void {
      if (token === undefined) {
        fanOut(
          attachments.filter((attachment) => attachment.probe.needsSpans),
          'spanFinished',
          undefined,
          span,
        );
        return;
      }
      const context = token as RuntimeSpanContext;
      for (const entry of context.entries) {
        if (!entry.attachment.active) continue;
        invokeProbe(entry.attachment.probe, 'spanFinished', entry.token, span);
      }
    },
  });
}

function createRuntimeProbeEventMetadata(
  runtime: RuntimeCore,
  parent: RuntimeProbeParent | undefined,
): RuntimeProbeEventMetadata {
  const nextEventInstanceId = (NEXT_EVENT_INSTANCE_ID.get(runtime) ?? 0) + 1;
  NEXT_EVENT_INSTANCE_ID.set(runtime, nextEventInstanceId);
  const runtimeInstanceId = runtime.identity.runtimeInstanceId;
  const parentEventInstanceId = parent?.tracking.eventMetadata.eventInstanceId;
  return Object.freeze({
    runtimeInstanceId,
    eventInstanceId: `evt_${runtimeInstanceId}_${nextEventInstanceId}`,
    ...(parentEventInstanceId === undefined ? {} : { parentEventInstanceId }),
  });
}

function fanOut(
  attachments: readonly RuntimeProbeAttachment[],
  method: keyof RuntimeProbe,
  ...args: readonly unknown[]
): void {
  for (const attachment of attachments) {
    if (!attachment.active) continue;
    invokeProbe(attachment.probe, method, ...args);
  }
}

function invokeProbe(
  probe: RuntimeProbe,
  method: keyof RuntimeProbe,
  ...args: readonly unknown[]
): void {
  const callback = probe[method];
  if (typeof callback !== 'function') return;
  try {
    (callback as (...values: readonly unknown[]) => unknown).call(probe, ...args);
  } catch (error) {
    consoleLog('warn', `[uklad] runtime probe failed during ${String(method)}.`, error);
  }
}
