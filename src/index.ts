// Re-export main functionality
export { initAppDb, getAppDb } from './db';

export { original, current, enableMapSet } from './immer-utils';

export { regEvent, regEventErrorHandler, defaultErrorHandler } from './events';
export { regSub, getSubscriptionValue } from './subs';
export { regEffect, DISPATCH_LATER, DISPATCH } from './fx';
export { regCoeffect, NOW, RANDOM } from './cofx';
export { regGlobalInterceptor, getGlobalInterceptors, clearGlobalInterceptors, setGlobalEqualityCheck, getGlobalEqualityCheck } from './settings';
export { shallowEqual } from './equality';
export { getHandler, getHandlers, clearHandlers, clearSubscriptionCache, clearSubs, getSubscriptionDiagnostics } from './registrar';

export { dispatch, dispatchSync } from './router';
export { debounceAndDispatch, throttleAndDispatch } from './debounce'
export { useSubscription } from './hook';
export { 
  registerHotReloadCallback, 
  triggerHotReload, 
  clearHotReloadCallbacks, 
  useHotReload, 
  useHotReloadKey, 
  setupSubsHotReload, 
  HotReloadWrapper 
} from './hot-reload';

// Trace
export { enableTracing, disableTracing, registerTraceCb, removeTraceCb, enableTracePrint } from './trace';

// Re-export types for external use
export type {
  EventVector,
  EventHandler,
  Interceptor,
  Id,
  SubVector,
  Db,
  Effects,
  CoEffects,
  CoEffectHandler,
  EffectHandler,
  Context,
  DispatchLaterEffect,
  ErrorHandler,
  SubConfig,
  EqualityCheckFn,
  // Opt-in typed payload maps (augment EventPayloads/SubPayloads/EffectPayloads/AppDb from app code)
  EventPayloads,
  SubPayloads,
  EffectPayloads,
  AppDb,
  DefaultAppDb,
  EventParams,
  EffectParams,
  DispatchVector,
  SubParams,
  SubResult,
  SubscribeVector,
  TraceErrorTag
} from './types';
export type { SubscriptionDiagnostic } from './subscription-runtime';
