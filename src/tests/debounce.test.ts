import { clear, clearAll, debounceAndDispatch, throttleAndDispatch } from '../debounce';
import { dispatch } from '../router';
import type { EventVector } from '../types';

// Mock the dispatch function
jest.mock('../router', () => ({
  dispatch: jest.fn(),
}));

const mockDispatch = dispatch as jest.MockedFunction<typeof dispatch>;

describe('debounce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();
    clearAll(); // Clear any existing timeouts
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    clearAll(); // Clean up after each test
  });

  describe('clear', () => {
    it('should clear a specific timeout by event key', () => {
      const event: EventVector = ['test-event', 'param'];

      // Start a debounced dispatch
      debounceAndDispatch(event, 1000);

      // Clear the specific event
      clear('test-event');

      // Fast-forward time past the debounce period
      jest.advanceTimersByTime(1100);

      // The event should not have been dispatched
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should handle clearing non-existent event keys gracefully', () => {
      // Should not throw when clearing a non-existent key
      expect(() => clear('non-existent-key')).not.toThrow();
    });

    it('should not affect other timeouts when clearing specific key', () => {
      const event1: EventVector = ['event1'];
      const event2: EventVector = ['event2'];

      debounceAndDispatch(event1, 1000);
      debounceAndDispatch(event2, 1000);

      // Clear only event1
      clear('event1');

      // Fast-forward time
      jest.advanceTimersByTime(1100);

      // Only event2 should have been dispatched
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

      // Start multiple debounced dispatches
      events.forEach((event) => debounceAndDispatch(event, 1000));

      // Clear all timeouts
      clearAll();

      // Fast-forward time past the debounce period
      jest.advanceTimersByTime(1100);

      // No events should have been dispatched
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

      // Should not dispatch immediately
      expect(mockDispatch).not.toHaveBeenCalled();

      // Fast-forward to just before the debounce period
      jest.advanceTimersByTime(499);
      expect(mockDispatch).not.toHaveBeenCalled();

      // Fast-forward past the debounce period
      jest.advanceTimersByTime(1);
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(event);
    });

    it('should cancel previous timeout when called multiple times with same event key', () => {
      const event: EventVector = ['test-event', 'param'];

      debounceAndDispatch(event, 500);
      jest.advanceTimersByTime(300);

      // Call again with same event key - should reset the timer
      debounceAndDispatch(event, 500);

      // Fast-forward 400ms (total 700ms from first call, but only 400ms from second)
      jest.advanceTimersByTime(400);
      expect(mockDispatch).not.toHaveBeenCalled();

      // Fast-forward remaining 100ms to complete second debounce
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

      // After 200ms total: event2 should dispatch (started at 100ms + 100ms duration)
      jest.advanceTimersByTime(100);
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(event2);

      // After 300ms total: event1 should dispatch
      jest.advanceTimersByTime(100);
      expect(mockDispatch).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenCalledWith(event1);
    });

    it('should handle zero duration', () => {
      const event: EventVector = ['test-event'];

      debounceAndDispatch(event, 0);

      // Should dispatch immediately when timer fires
      jest.advanceTimersByTime(0);
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(event);
    });
  });

  describe('throttleAndDispatch', () => {
    it('should dispatch immediately on first call', () => {
      const event: EventVector = ['test-event', 'param'];

      throttleAndDispatch(event, 500);

      // Should dispatch immediately
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(event);
    });

    it('should ignore subsequent calls within throttle period', () => {
      const event: EventVector = ['test-event', 'param'];

      throttleAndDispatch(event, 500);
      expect(mockDispatch).toHaveBeenCalledTimes(1);

      // Call again within throttle period
      throttleAndDispatch(event, 500);
      throttleAndDispatch(event, 500);
      throttleAndDispatch(event, 500);

      // Should not dispatch additional events
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });

    it('should allow dispatch after throttle period expires', () => {
      const event: EventVector = ['test-event', 'param'];

      throttleAndDispatch(event, 500);
      expect(mockDispatch).toHaveBeenCalledTimes(1);

      // Fast-forward past throttle period
      jest.advanceTimersByTime(500);

      // Should be able to dispatch again
      throttleAndDispatch(event, 500);
      expect(mockDispatch).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenCalledWith(event);
    });

    it('should handle multiple different event keys independently', () => {
      const event1: EventVector = ['event1'];
      const event2: EventVector = ['event2'];

      throttleAndDispatch(event1, 500);
      throttleAndDispatch(event2, 500);

      // Both should dispatch immediately
      expect(mockDispatch).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenNthCalledWith(1, event1);
      expect(mockDispatch).toHaveBeenNthCalledWith(2, event2);

      // Subsequent calls within throttle period should be ignored
      throttleAndDispatch(event1, 500);
      throttleAndDispatch(event2, 500);
      expect(mockDispatch).toHaveBeenCalledTimes(2);
    });

    it('should handle zero duration throttle', () => {
      const event: EventVector = ['test-event'];

      throttleAndDispatch(event, 0);
      expect(mockDispatch).toHaveBeenCalledTimes(1);

      // Fast-forward minimal time
      jest.advanceTimersByTime(0);

      // Should be able to throttle again immediately
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

      // Throttle should dispatch immediately
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(throttleEvent);

      jest.advanceTimersByTime(300);

      // Debounce should dispatch after delay
      expect(mockDispatch).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenCalledWith(debounceEvent);
    });

    it('should handle clearing during active debounce/throttle', () => {
      const event: EventVector = ['mixed-event'];

      debounceAndDispatch(event, 500);
      throttleAndDispatch(event, 500);

      // Throttle dispatches immediately
      expect(mockDispatch).toHaveBeenCalledTimes(1);

      // Clear the debounce timeout
      clear('mixed-event');

      jest.advanceTimersByTime(500);

      // Only the throttle should have dispatched, debounce was cleared
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });
  });
});
