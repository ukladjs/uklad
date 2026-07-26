import type {
  Context,
  EventHandler,
  Interceptor,
  SubDepsHandler,
  SubHandler,
} from '../../src/types';
import {
  clearHandlers,
  clearEventHandlers,
  clearSubscriptionHandlers,
  clearSubs,
  getHandler,
  getHandlers,
  getEventInterceptors,
  getRootSubSourceById,
  getSubConfig,
  handlerRegistry,
  hasHandler,
  registerHandler,
  setEventInterceptors,
  setRootSubSource,
  setSubConfig,
} from './runtime-test-api';

describe('handler registry', () => {
  beforeEach(() => {
    clearHandlers();
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'supports prototype-named handler id %s',
    (id) => {
      const handler: EventHandler = () => undefined;

      expect(getHandler(handlerRegistry.event, id)).toBeUndefined();
      expect(hasHandler(handlerRegistry.event, id)).toBe(false);

      registerHandler(handlerRegistry.event, id, handler);

      expect(getHandler(handlerRegistry.event, id)).toBe(handler);
      expect(getHandlers().event[id]).toBe(handler);
      expect(hasHandler(handlerRegistry.event, id)).toBe(true);
      expect(Object.getPrototypeOf(getHandlers().event)).toBeNull();
    },
  );

  it('returns a live registry view', () => {
    const registry = getHandlers();
    const handler = jest.fn();

    registerHandler(handlerRegistry.event, 'live-handler', handler);

    expect(registry.event['live-handler']).toBe(handler);
  });

  it('does not log when a handler lookup misses', () => {
    expect(getHandler(handlerRegistry.event, 'missing-handler')).toBeUndefined();
    expect(getTestLogCalls().error).toEqual([]);
  });

  it('correlates handler lookup types with their kinds', () => {
    const eventHandler: EventHandler = () => undefined;
    const depsHandler: SubDepsHandler = () => [];
    registerHandler(handlerRegistry.event, 'typed-event', eventHandler);
    registerHandler(handlerRegistry.subDeps, 'typed-sub', depsHandler);

    const typedEventHandler: EventHandler | undefined = getHandler(
      handlerRegistry.event,
      'typed-event',
    );
    const typedDepsHandler: SubDepsHandler | undefined = getHandler(
      handlerRegistry.subDeps,
      'typed-sub',
    );

    expect(typedEventHandler).toBe(eventHandler);
    expect(typedDepsHandler).toBe(depsHandler);
  });

  it('clears interceptor metadata with an event handler', () => {
    const eventId = 'event-with-interceptors';
    const interceptor: Interceptor = {
      id: 'metadata',
      before: (context: Context) => context,
    };
    registerHandler(handlerRegistry.event, eventId, () => undefined);
    setEventInterceptors(eventId, [interceptor]);

    clearEventHandlers(eventId);

    expect(getHandler(handlerRegistry.event, eventId)).toBeUndefined();
    expect(getEventInterceptors(eventId)).toEqual([]);
  });

  it('owns an immutable interceptor list after registration', () => {
    const interceptor: Interceptor = {
      id: 'immutable-metadata',
      before: (context: Context) => context,
    };
    const registered = [interceptor];

    registerHandler(handlerRegistry.event, 'immutable-event', () => undefined);
    setEventInterceptors('immutable-event', registered);
    registered.length = 0;

    const stored = getEventInterceptors('immutable-event');
    expect(stored).toEqual([interceptor]);
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it('clears a complete subscription definition and its metadata', () => {
    const subId = 'subscription-with-metadata';
    const subHandler: SubHandler = () => 1;
    const depsHandler: SubDepsHandler = () => [];
    registerHandler(handlerRegistry.sub, subId, subHandler);
    registerHandler(handlerRegistry.subDeps, subId, depsHandler);
    setRootSubSource(subId, 'source-key');
    setSubConfig(subId, { equalityCheck: Object.is });

    clearSubscriptionHandlers(subId);

    expect(getHandler(handlerRegistry.sub, subId)).toBeUndefined();
    expect(getHandler(handlerRegistry.subDeps, subId)).toBeUndefined();
    expect(getRootSubSourceById(subId)).toBeUndefined();
    expect(getSubConfig(subId)).toBeUndefined();
  });

  it('preserves clearSubs as the complete subscription reset', () => {
    const subId = 'clear-subs-definition';
    registerHandler(handlerRegistry.sub, subId, () => 1);
    registerHandler(handlerRegistry.subDeps, subId, () => []);
    setSubConfig(subId, { equalityCheck: Object.is });

    clearSubs();

    expect(getHandler(handlerRegistry.sub, subId)).toBeUndefined();
    expect(getHandler(handlerRegistry.subDeps, subId)).toBeUndefined();
    expect(getSubConfig(subId)).toBeUndefined();
  });
});
