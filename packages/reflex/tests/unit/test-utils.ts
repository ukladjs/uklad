import type { EventVector } from '../../src/types';

/**
 * Yield through the host mechanism used by `scheduleNextTick`:
 * - setImmediate (React Native)
 * - MessageChannel (Web)
 * - setTimeout (fallback)
 */
export const waitForScheduled = async () => {
  if (typeof (globalThis as any).setImmediate === 'function') {
    await new Promise((resolve) => (globalThis as any).setImmediate(resolve));
    return;
  }

  if (typeof MessageChannel !== 'undefined') {
    await new Promise((resolve) => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => resolve(undefined);
      port2.postMessage(undefined);
    });
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 0));
};

export const waitForAnimationFrame = async () => {
  if (typeof requestAnimationFrame !== 'undefined') {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  } else {
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
};

/** Yield one microtask after scheduler-driven work. */
export const waitForSubscription = async () => {
  await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
};

/** Wait for queued event work, then yield one microtask to observers. */
export const waitForEventAndSubscription = async () => {
  await waitForScheduled();
  await waitForSubscription();
};

export const createEventWithMeta = (eventId: string, meta: Record<string, any>): EventVector => {
  const event = [eventId] as EventVector;
  (event as any).meta = meta;
  return event;
};
