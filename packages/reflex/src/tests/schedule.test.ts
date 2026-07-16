/**
 * @jest-environment jsdom
 */
import { scheduleAfterRender } from '../core/scheduling';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('scheduleAfterRender', () => {
  it('should run the callback exactly once on a visible tab (rAF wins the race)', async () => {
    const callback = jest.fn();

    scheduleAfterRender(callback);
    expect(callback).not.toHaveBeenCalled();

    // Past the timeout-fallback margin: the rAF path must have canceled it
    await wait(150);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should fall back to a timeout when rAF never fires (hidden tab)', async () => {
    const originalRaf = window.requestAnimationFrame;
    // Simulate a hidden tab: rAF registers but never fires
    window.requestAnimationFrame = (() => 1) as any;

    try {
      const callback = jest.fn();
      scheduleAfterRender(callback);

      await wait(50);
      expect(callback).not.toHaveBeenCalled();

      await wait(100);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
  });

  it('should skip rAF entirely when the document is already hidden', async () => {
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (() => 1) as any; // would never fire
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });

    try {
      const callback = jest.fn();
      scheduleAfterRender(callback);

      // Well below the 100ms fallback margin: the direct timeout path ran
      await wait(50);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      window.requestAnimationFrame = originalRaf;
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    }
  });
});
