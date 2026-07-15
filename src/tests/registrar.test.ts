import type { Context, EventHandler, Interceptor, SubDepsHandler, SubHandler } from '../types';
import {
  clearHandlers,
  clearSubs,
  getHandler,
  getHandlers,
  getInterceptors,
  getRootSubSourceById,
  getSubConfig,
  hasHandler,
  registerHandler,
  setInterceptors,
  setRootSubSource,
  setSubConfig,
} from '../registrar';

describe('handler registry', () => {
  beforeEach(() => {
    clearHandlers();
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'supports prototype-named handler id %s',
    (id) => {
      const handler: EventHandler = () => undefined;

      expect(getHandler('event', id)).toBeUndefined();
      expect(hasHandler('event', id)).toBe(false);

      registerHandler('event', id, handler);

      expect(getHandler('event', id)).toBe(handler);
      expect(getHandlers().event[id]).toBe(handler);
      expect(hasHandler('event', id)).toBe(true);
      expect(Object.getPrototypeOf(getHandlers().event)).toBeNull();
    },
  );

  it('does not log when a handler lookup misses', () => {
    expect(getHandler('event', 'missing-handler')).toBeUndefined();
    expect(getTestLogCalls().error).toEqual([]);
  });

  it('correlates handler lookup types with their kinds', () => {
    const eventHandler: EventHandler = () => undefined;
    const depsHandler: SubDepsHandler = () => [];
    registerHandler('event', 'typed-event', eventHandler);
    registerHandler('subDeps', 'typed-sub', depsHandler);

    const typedEventHandler: EventHandler | undefined = getHandler('event', 'typed-event');
    const typedDepsHandler: SubDepsHandler | undefined = getHandler('subDeps', 'typed-sub');

    expect(typedEventHandler).toBe(eventHandler);
    expect(typedDepsHandler).toBe(depsHandler);
  });

  it('clears interceptor metadata with an event handler', () => {
    const eventId = 'event-with-interceptors';
    const interceptor: Interceptor = {
      id: 'metadata',
      before: (context: Context) => context,
    };
    registerHandler('event', eventId, () => undefined);
    setInterceptors(eventId, [interceptor]);

    clearHandlers('event', eventId);

    expect(getHandler('event', eventId)).toBeUndefined();
    expect(getInterceptors(eventId)).toEqual([]);
  });

  it('clears a complete subscription definition and its metadata', () => {
    const subId = 'subscription-with-metadata';
    const subHandler: SubHandler = () => 1;
    const depsHandler: SubDepsHandler = () => [];
    registerHandler('sub', subId, subHandler);
    registerHandler('subDeps', subId, depsHandler);
    setRootSubSource(subId, 'source-key');
    setSubConfig(subId, { equalityCheck: Object.is });

    clearHandlers('sub', subId);

    expect(getHandler('sub', subId)).toBeUndefined();
    expect(getHandler('subDeps', subId)).toBeUndefined();
    expect(getRootSubSourceById(subId)).toBeUndefined();
    expect(getSubConfig(subId)).toBeUndefined();
  });

  it('preserves clearSubs as the complete subscription reset', () => {
    const subId = 'clear-subs-definition';
    registerHandler('sub', subId, () => 1);
    registerHandler('subDeps', subId, () => []);
    setSubConfig(subId, { equalityCheck: Object.is });

    clearSubs();

    expect(getHandler('sub', subId)).toBeUndefined();
    expect(getHandler('subDeps', subId)).toBeUndefined();
    expect(getSubConfig(subId)).toBeUndefined();
  });
});
