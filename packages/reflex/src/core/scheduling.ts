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
export function scheduleNextTick(callback: () => void): void {
  const setImmediate = (globalThis as { setImmediate?: (task: () => void) => void }).setImmediate;
  if (typeof setImmediate === 'function') {
    setImmediate(callback);
    return;
  }

  if (typeof MessageChannel !== 'undefined') {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => callback();
    port2.postMessage(undefined);
    return;
  }

  setTimeout(callback, 0);
}
