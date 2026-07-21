/**
 * @jest-environment jsdom
 */
import { renderHook, cleanup, act } from '@testing-library/react';
import { createElement, type ComponentType, type PropsWithChildren } from 'react';
import { ReflexProvider } from '../react/context';
import {
  registerHotReloadCallback,
  triggerHotReload,
  clearHotReloadCallbacks,
  useHotReload,
  useHotReloadKey,
  setupSubsHotReload,
} from '../react/hot-reload';
import { createReflexRuntime, type ReflexRuntime } from '../runtime/runtime';

function runtimeWrapper(runtime: ReflexRuntime): ComponentType<PropsWithChildren> {
  return ({ children }) => createElement(ReflexProvider, { runtime }, children);
}

describe('Hot Reload System', () => {
  let runtime: ReflexRuntime;
  let runtimeSequence = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    runtime = createReflexRuntime({
      initialDb: {},
      runtimeId: `hot-reload-test-${++runtimeSequence}`,
    });
  });

  afterEach(() => {
    cleanup();
    clearHotReloadCallbacks(runtime);
    runtime.dispose();
  });

  describe('Callback Management', () => {
    it('should register and trigger callbacks correctly', () => {
      const mockCallback1 = jest.fn();
      const mockCallback2 = jest.fn();

      const unregister1 = registerHotReloadCallback(runtime, mockCallback1);
      const unregister2 = registerHotReloadCallback(runtime, mockCallback2);

      triggerHotReload(runtime);

      expect(mockCallback1).toHaveBeenCalledTimes(1);
      expect(mockCallback2).toHaveBeenCalledTimes(1);

      unregister1();

      triggerHotReload(runtime);

      expect(mockCallback1).toHaveBeenCalledTimes(1);
      expect(mockCallback2).toHaveBeenCalledTimes(2);

      unregister2();

      triggerHotReload(runtime);

      expect(mockCallback1).toHaveBeenCalledTimes(1);
      expect(mockCallback2).toHaveBeenCalledTimes(2);
    });

    it('should handle callback errors gracefully', () => {
      const mockCallback1 = jest.fn();
      const mockCallback2 = jest.fn(() => {
        throw new Error('Test error');
      });
      const mockCallback3 = jest.fn();

      registerHotReloadCallback(runtime, mockCallback1);
      registerHotReloadCallback(runtime, mockCallback2);
      registerHotReloadCallback(runtime, mockCallback3);

      triggerHotReload(runtime);

      expect(mockCallback1).toHaveBeenCalledTimes(1);
      expect(mockCallback2).toHaveBeenCalledTimes(1);
      expect(mockCallback3).toHaveBeenCalledTimes(1);
    });

    it('should clear all callbacks', () => {
      const mockCallback1 = jest.fn();
      const mockCallback2 = jest.fn();

      registerHotReloadCallback(runtime, mockCallback1);
      registerHotReloadCallback(runtime, mockCallback2);

      clearHotReloadCallbacks(runtime);

      triggerHotReload(runtime);

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

      renderHook(() => TestComponent(), { wrapper: runtimeWrapper(runtime) });

      expect(TestComponent).toHaveBeenCalledTimes(1);

      act(() => {
        triggerHotReload(runtime);
      });

      expect(TestComponent).toHaveBeenCalledTimes(2);
    });

    it('should provide changing keys with useHotReloadKey', () => {
      const { result } = renderHook(() => useHotReloadKey(), { wrapper: runtimeWrapper(runtime) });

      const initialKey = result.current;
      expect(typeof initialKey).toBe('string');

      act(() => {
        triggerHotReload(runtime);
      });

      const newKey = result.current;
      expect(newKey).not.toBe(initialKey);
      expect(typeof newKey).toBe('string');
    });

    it('should cleanup callbacks when component unmounts', () => {
      const mockCallback = jest.fn();

      const { unmount } = renderHook(
        () => {
          useHotReload();
          registerHotReloadCallback(runtime, mockCallback);
        },
        { wrapper: runtimeWrapper(runtime) },
      );

      act(() => {
        triggerHotReload(runtime);
      });

      expect(mockCallback).toHaveBeenCalledTimes(1);

      unmount();

      clearHotReloadCallbacks(runtime);

      act(() => {
        triggerHotReload(runtime);
      });

      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('setupSubsHotReload', () => {
    it('should provide dispose and accept functions', () => {
      runtime.regSub('value');
      const { dispose, accept } = setupSubsHotReload(runtime);

      expect(typeof dispose).toBe('function');
      expect(typeof accept).toBe('function');

      dispose();
      expect(runtime.getHandlers().sub.value).toBeUndefined();

      const mockCallback = jest.fn();
      registerHotReloadCallback(runtime, mockCallback);

      accept({ newModule: true });
      expect(mockCallback).toHaveBeenCalledTimes(1);

      accept();
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should not trigger callbacks when accept is called without new module', () => {
      const mockCallback = jest.fn();
      const { accept } = setupSubsHotReload(runtime);

      registerHotReloadCallback(runtime, mockCallback);

      accept();
      expect(mockCallback).not.toHaveBeenCalled();

      accept(null);
      expect(mockCallback).not.toHaveBeenCalled();

      accept(undefined);
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('clears an explicit runtime while its current React-style graph is active', () => {
      const runtime = createReflexRuntime({
        initialDb: { value: 1 },
        runtimeId: 'explicit-hmr-runtime',
      });
      runtime.regSub('value');
      const unsubscribe = runtime.watchSubscription(['value'], () => {});
      const { dispose } = setupSubsHotReload(runtime);

      expect(() => dispose()).not.toThrow();
      expect(runtime.getHandlers().sub.value).toBeUndefined();

      unsubscribe();
      runtime.dispose();
    });

    it('can clear only module-owned subscription definitions', () => {
      const runtime = createReflexRuntime({
        initialDb: { value: 1, persistStatus: 'idle' },
        runtimeId: 'scoped-hmr-runtime',
      });
      runtime.regSub('value');
      runtime.regSub('persist-status', 'persistStatus');
      const unsubscribe = runtime.watchSubscription(['value'], () => {});
      const { dispose } = setupSubsHotReload(runtime, ['value']);

      expect(() => dispose()).not.toThrow();
      expect(runtime.getHandlers().sub.value).toBeUndefined();
      expect(runtime.getHandlers().sub['persist-status']).toBeDefined();

      unsubscribe();
      runtime.dispose();
    });
  });

  describe('Integration Test', () => {
    it('should work with a complete hot reload workflow', () => {
      const mockCallback = jest.fn();

      runtime.regSub('value');
      const { dispose, accept } = setupSubsHotReload(runtime);
      registerHotReloadCallback(runtime, mockCallback);

      dispose();
      expect(runtime.getHandlers().sub.value).toBeUndefined();

      accept({ newModule: true });
      expect(mockCallback).toHaveBeenCalledTimes(1);

      triggerHotReload(runtime);
      expect(mockCallback).toHaveBeenCalledTimes(2);
    });
  });
});
