import {
  clear,
  clearAll,
  debounceAndDispatch,
  testEventRuntime,
  throttleAndDispatch,
} from './runtime-test-api';
import type { EventVector } from '../types';

let mockDispatch: jest.SpiedFunction<typeof testEventRuntime.dispatch>;

describe('debounce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();
    clearAll();
    mockDispatch = jest.spyOn(testEventRuntime, 'dispatch').mockImplementation();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    mockDispatch.mockRestore();
    jest.useRealTimers();
    clearAll();
  });

  describe('clear', () => {
    it('should clear a specific timeout by event key', () => {
      const event: EventVector = ['test-event', 'param'];

      debounceAndDispatch(event, 1000);

      clear('test-event');

      jest.advanceTimersByTime(1100);

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should handle clearing non-existent event keys gracefully', () => {
      expect(() => clear('non-existent-key')).not.toThrow();
    });

    it('should not affect other timeouts when clearing specific key', () => {
      const event1: EventVector = ['event1'];
      const event2: EventVector = ['event2'];

      debounceAndDispatch(event1, 1000);
      debounceAndDispatch(event2, 1000);

      clear('event1');

      jest.advanceTimersByTime(1100);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(event2);
    });
  });

  describe('clearAll', () => {
    it('should clear all active timeouts', () => {
      const events: EventVector[] = [
        ['event1', 'param1'],
        ['event2', 'param2'],
        ['event3', 'param3'],
      ];

      events.forEach((event) => debounceAndDispatch(event, 1000));

      clearAll();

      jest.advanceTimersByTime(1100);

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should handle clearing when no timeouts exist', () => {
      expect(() => clearAll()).not.toThrow();
    });
  });

  describe('debounceAndDispatch', () => {
    it('should dispatch event after debounce period', () => {
      const event: EventVector = ['test-event', 'param'];

      debounceAndDispatch(event, 500);

      expect(mockDispatch).not.toHaveBeenCalled();

      jest.advanceTimersByTime(499);
      expect(mockDispatch).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(event);
    });

    it('should cancel previous timeout when called multiple times with same event key', () => {
      const event: EventVector = ['test-event', 'param'];

      debounceAndDispatch(event, 500);
      jest.advanceTimersByTime(300);

      debounceAndDispatch(event, 500);

      // At 700 ms overall, only 400 ms has elapsed since the replacement call.
      jest.advanceTimersByTime(400);
      expect(mockDispatch).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(event);
    });

    it('should handle multiple different event keys independently', () => {
      const event1: EventVector = ['event1', 'param1'];
      const event2: EventVector = ['event2', 'param2'];

      debounceAndDispatch(event1, 300);
      jest.advanceTimersByTime(100);
      debounceAndDispatch(event2, 100);

      // At 200 ms overall, only event2 is due.
      jest.advanceTimersByTime(100);
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(event2);

      jest.advanceTimersByTime(100);
      expect(mockDispatch).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenCalledWith(event1);
    });

    it('should handle zero duration', () => {
      const event: EventVector = ['test-event'];

      debounceAndDispatch(event, 0);

      jest.advanceTimersByTime(0);
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(event);
    });
  });

  describe('throttleAndDispatch', () => {
    it('should dispatch immediately on first call', () => {
      const event: EventVector = ['test-event', 'param'];

      throttleAndDispatch(event, 500);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(event);
    });

    it('should ignore subsequent calls within throttle period', () => {
      const event: EventVector = ['test-event', 'param'];

      throttleAndDispatch(event, 500);
      expect(mockDispatch).toHaveBeenCalledTimes(1);

      throttleAndDispatch(event, 500);
      throttleAndDispatch(event, 500);
      throttleAndDispatch(event, 500);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });

    it('should allow dispatch after throttle period expires', () => {
      const event: EventVector = ['test-event', 'param'];

      throttleAndDispatch(event, 500);
      expect(mockDispatch).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(500);

      throttleAndDispatch(event, 500);
      expect(mockDispatch).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenCalledWith(event);
    });

    it('should handle multiple different event keys independently', () => {
      const event1: EventVector = ['event1'];
      const event2: EventVector = ['event2'];

      throttleAndDispatch(event1, 500);
      throttleAndDispatch(event2, 500);

      expect(mockDispatch).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenNthCalledWith(1, event1);
      expect(mockDispatch).toHaveBeenNthCalledWith(2, event2);

      throttleAndDispatch(event1, 500);
      throttleAndDispatch(event2, 500);
      expect(mockDispatch).toHaveBeenCalledTimes(2);
    });

    it('should handle zero duration throttle', () => {
      const event: EventVector = ['test-event'];

      throttleAndDispatch(event, 0);
      expect(mockDispatch).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(0);

      throttleAndDispatch(event, 0);
      expect(mockDispatch).toHaveBeenCalledTimes(2);
    });
  });

  describe('integration scenarios', () => {
    it('should handle mixed debounce and throttle operations', () => {
      const debounceEvent: EventVector = ['debounce-event'];
      const throttleEvent: EventVector = ['throttle-event'];

      debounceAndDispatch(debounceEvent, 300);
      throttleAndDispatch(throttleEvent, 300);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(throttleEvent);

      jest.advanceTimersByTime(300);

      expect(mockDispatch).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenCalledWith(debounceEvent);
    });

    it('should handle clearing during active debounce/throttle', () => {
      const event: EventVector = ['mixed-event'];

      debounceAndDispatch(event, 500);
      throttleAndDispatch(event, 500);

      expect(mockDispatch).toHaveBeenCalledTimes(1);

      clear('mixed-event');

      jest.advanceTimersByTime(500);

      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });
  });
});
