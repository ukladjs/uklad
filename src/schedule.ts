// Helpers for scheduling callbacks

// requestAnimationFrame does not fire in hidden tabs (and can pause in
// backgrounded React Native apps), which would stall subscription flushes
// while events keep committing db changes. Every schedule races rAF against a
// timeout fallback: on a visible tab rAF wins (frame-aligned as before), on a
// hidden one the timeout bounds the stall. The margin is far above any normal
// frame so the fallback never preempts a healthy rAF.
const RAF_FALLBACK_MS = 100;

export function scheduleAfterRender(f: () => void): void {
  if (typeof requestAnimationFrame === 'undefined') {
    // Fallback for non-browser environments
    setTimeout(f, 16);
    return;
  }

  if (typeof document !== 'undefined' && document.hidden) {
    // rAF won't fire at all; don't wait out the fallback margin
    setTimeout(f, 16);
    return;
  }

  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    f();
  };
  const rafId = requestAnimationFrame(() => {
    clearTimeout(timeoutId);
    Promise.resolve().then(run);
  });
  const timeoutId = setTimeout(() => {
    // The tab went hidden (or rAF stalled) after scheduling
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rafId);
    }
    run();
  }, RAF_FALLBACK_MS);
}

// Next Tick is needed to split event processing into chunks
export function scheduleNextTick(f: () => void): void {
  //React Native
  if (typeof (globalThis as any).setImmediate === 'function') {
    (globalThis as any).setImmediate(f);
    return;
  }

  //Web
  if (typeof MessageChannel !== 'undefined') {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => f();
    port2.postMessage(undefined);
    return;
  }

  // Fallback
  setTimeout(f, 0);
}
