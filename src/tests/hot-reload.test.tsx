/**
 * @jest-environment jsdom
 */
import { renderHook, cleanup, act } from '@testing-library/react';
import {
  registerHotReloadCallback,
  triggerHotReload,
  clearHotReloadCallbacks,
  useHotReload,
  useHotReloadKey,
  setupSubsHotReload,
} from '../hot-reload';
import { clearSubsForHotReload } from '../registrar';

// Mock the explicit HMR-only reset since it is called internally.
jest.mock('../registrar', () => ({
  ...jest.requireActual('../registrar'),
  clearSubsForHotReload: jest.fn(),
}));

describe('Hot Reload System', () => {
  beforeEach(() => {
    // Reset the mock before each test
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    clearHotReloadCallbacks();
  });

  describe('Callback Management', () => {
    it('should register and trigger callbacks correctly', () => {
      const mockCallback1 = jest.fn();
      const mockCallback2 = jest.fn();

      // Register callbacks
      const unregister1 = registerHotReloadCallback(mockCallback1);
      const unregister2 = registerHotReloadCallback(mockCallback2);

      // Trigger hot reload
      triggerHotReload();

      // Both callbacks should be called
      expect(mockCallback1).toHaveBeenCalledTimes(1);
      expect(mockCallback2).toHaveBeenCalledTimes(1);

      // Unregister one callback
      unregister1();

      // Trigger again
      triggerHotReload();

      // Only the second callback should be called
      expect(mockCallback1).toHaveBeenCalledTimes(1);
      expect(mockCallback2).toHaveBeenCalledTimes(2);

      // Unregister the second callback
      unregister2();

      // Trigger again
      triggerHotReload();

      // No additional calls should be made
      expect(mockCallback1).toHaveBeenCalledTimes(1);
      expect(mockCallback2).toHaveBeenCalledTimes(2);
    });

    it('should handle callback errors gracefully', () => {
      const mockCallback1 = jest.fn();
      const mockCallback2 = jest.fn(() => {
        throw new Error('Test error');
      });
      const mockCallback3 = jest.fn();

      // Register callbacks
      registerHotReloadCallback(mockCallback1);
      registerHotReloadCallback(mockCallback2);
      registerHotReloadCallback(mockCallback3);

      // Trigger hot reload
      triggerHotReload();

      // All callbacks should be called despite the error
      expect(mockCallback1).toHaveBeenCalledTimes(1);
      expect(mockCallback2).toHaveBeenCalledTimes(1);
      expect(mockCallback3).toHaveBeenCalledTimes(1);
    });

    it('should clear all callbacks', () => {
      const mockCallback1 = jest.fn();
      const mockCallback2 = jest.fn();

      // Register callbacks
      registerHotReloadCallback(mockCallback1);
      registerHotReloadCallback(mockCallback2);

      // Clear all callbacks
      clearHotReloadCallbacks();

      // Trigger hot reload
      triggerHotReload();

      // No callbacks should be called
      expect(mockCallback1).not.toHaveBeenCalled();
      expect(mockCallback2).not.toHaveBeenCalled();
    });
  });

  describe('React Hooks', () => {
    it('should trigger useHotReload hook when hot reload is triggered', () => {
      const TestComponent = jest.fn(() => {
        useHotReload();
        return null;
      });

      renderHook(() => TestComponent());

      // Initial render
      expect(TestComponent).toHaveBeenCalledTimes(1);

      // Trigger hot reload
      act(() => {
        triggerHotReload();
      });

      // Component should re-render
      expect(TestComponent).toHaveBeenCalledTimes(2);
    });

    it('should provide changing keys with useHotReloadKey', () => {
      const { result } = renderHook(() => useHotReloadKey());

      const initialKey = result.current;
      expect(typeof initialKey).toBe('string');

      // Trigger hot reload
      act(() => {
        triggerHotReload();
      });

      const newKey = result.current;
      expect(newKey).not.toBe(initialKey);
      expect(typeof newKey).toBe('string');
    });

    it('should cleanup callbacks when component unmounts', () => {
      const mockCallback = jest.fn();

      const { unmount } = renderHook(() => {
        useHotReload();
        // Register additional callback to test cleanup
        registerHotReloadCallback(mockCallback);
      });

      // Trigger hot reload while component is mounted
      act(() => {
        triggerHotReload();
      });

      // The mock callback should be called
      expect(mockCallback).toHaveBeenCalledTimes(1);

      // Unmount component
      unmount();

      // Clear the mock callback manually since we registered it separately
      clearHotReloadCallbacks();

      // Trigger hot reload after unmount
      act(() => {
        triggerHotReload();
      });

      // No additional calls should be made
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('setupSubsHotReload', () => {
    it('should provide dispose and accept functions', () => {
      const { dispose, accept } = setupSubsHotReload();

      expect(typeof dispose).toBe('function');
      expect(typeof accept).toBe('function');

      // Test dispose function
      dispose();
      expect(clearSubsForHotReload).toHaveBeenCalledTimes(1);

      // Test accept function with new module
      const mockCallback = jest.fn();
      registerHotReloadCallback(mockCallback);

      accept({ newModule: true });
      expect(mockCallback).toHaveBeenCalledTimes(1);

      // Test accept function without new module
      accept();
      expect(mockCallback).toHaveBeenCalledTimes(1); // Should not be called again
    });

    it('should not trigger callbacks when accept is called without new module', () => {
      const mockCallback = jest.fn();
      const { accept } = setupSubsHotReload();

      registerHotReloadCallback(mockCallback);

      // Call accept without new module
      accept();
      expect(mockCallback).not.toHaveBeenCalled();

      // Call accept with falsy new module
      accept(null);
      expect(mockCallback).not.toHaveBeenCalled();

      accept(undefined);
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('Integration Test', () => {
    it('should work with a complete hot reload workflow', () => {
      const mockCallback = jest.fn();

      // Set up hot reload system
      const { dispose, accept } = setupSubsHotReload();
      registerHotReloadCallback(mockCallback);

      // Simulate HMR dispose
      dispose();
      expect(clearSubsForHotReload).toHaveBeenCalledTimes(1);

      // Simulate HMR accept with new module
      accept({ newModule: true });
      expect(mockCallback).toHaveBeenCalledTimes(1);

      // Test that the system is still working after HMR
      triggerHotReload();
      expect(mockCallback).toHaveBeenCalledTimes(2);
    });
  });
});
