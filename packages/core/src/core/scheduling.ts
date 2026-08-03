// A hidden browser tab can suspend requestAnimationFrame indefinitely while
// events continue committing app STATE changes. The fallback bounds that delay
// without preempting a normally scheduled frame.
const FRAME_FALLBACK_DELAY_MS = 100;
const TIMER_FRAME_DELAY_MS = 16;

/**
 * Schedule `callback` after the next render opportunity.
 *
 * A visible browser uses `requestAnimationFrame` followed by a microtask. A
 * timer handles non-browser environments, already-hidden documents, and
 * frames that stall after scheduling. The callback runs at most once.
 */
export function scheduleAfterRender(callback: () => void): void {
  if (typeof requestAnimationFrame === 'undefined') {
    setTimeout(callback, TIMER_FRAME_DELAY_MS);
    return;
  }

  if (typeof document !== 'undefined' && document.hidden) {
    setTimeout(callback, TIMER_FRAME_DELAY_MS);
    return;
  }

  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    callback();
  };
  const animationFrameId = requestAnimationFrame(() => {
    clearTimeout(fallbackTimer);
    Promise.resolve().then(run);
  });
  const fallbackTimer = setTimeout(() => {
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(animationFrameId);
    }
    run();
  }, FRAME_FALLBACK_DELAY_MS);
}

/**
 * Schedule event work on the next host task.
 *
 * React Native uses `setImmediate`, browsers use `MessageChannel`, and other
 * environments fall back to a zero-delay timer.
 */
/**
 * @internal Build the browser tick scheduler over one lazily created channel.
 *
 * A channel per call would allocate two ports and a message for every queue
 * cycle. One shared channel plus a FIFO gives the same ordering, because ports
 * deliver in post order and each `postMessage` drains exactly one callback.
 *
 * The channel factory is a parameter so this path can be exercised where
 * `setImmediate` exists — deleting that global to reach it is not an option,
 * since the test runner itself depends on it.
 */
export function createMessageChannelScheduler(
  createChannel: () => MessageChannel,
): (callback: () => void) => void {
  let port: MessagePort | undefined;
  const pending: Array<() => void> = [];
  let cursor = 0;

  const drainOne = (): void => {
    const callback = pending[cursor];
    // Release the reference immediately; a long-lived queue must not retain
    // callbacks it has already run.
    pending[cursor++] = noop;
    if (cursor >= pending.length) {
      pending.length = 0;
      cursor = 0;
    }
    callback?.();
  };

  return (callback: () => void): void => {
    if (port === undefined) {
      const channel = createChannel();
      channel.port1.onmessage = drainOne;
      port = channel.port2;
    }
    pending.push(callback);
    port.postMessage(undefined);
  };
}

function noop(): void {}

const scheduleViaMessageChannel =
  typeof MessageChannel === 'undefined'
    ? undefined
    : createMessageChannelScheduler(() => new MessageChannel());

export function scheduleNextTick(callback: () => void): void {
  const setImmediate = (globalThis as { setImmediate?: (task: () => void) => void }).setImmediate;
  if (typeof setImmediate === 'function') {
    setImmediate(callback);
    return;
  }

  if (scheduleViaMessageChannel !== undefined) {
    scheduleViaMessageChannel(callback);
    return;
  }

  setTimeout(callback, 0);
}
