import { DISPATCH, DISPATCH_LATER } from '../index';
import { defaultErrorHandler } from '../events/runner';
import {
  clearHandlers,
  getHandler,
  handlerRegistry,
  regEffect,
  regEventErrorHandler,
} from './runtime-test-api';

describe('framework handler lifecycle', () => {
  it('restores built-in effects after a complete handler clear', () => {
    expect(getHandler(handlerRegistry.fx, DISPATCH)).toBeDefined();
    expect(getHandler(handlerRegistry.fx, DISPATCH_LATER)).toBeDefined();
    expect(getHandler(handlerRegistry.error, 'event-handler')).toBe(defaultErrorHandler);

    clearHandlers();

    expect(getHandler(handlerRegistry.fx, DISPATCH)).toBeDefined();
    expect(getHandler(handlerRegistry.fx, DISPATCH_LATER)).toBeDefined();
    expect(getHandler(handlerRegistry.error, 'event-handler')).toBe(defaultErrorHandler);
  });

  it('restores a built-in effect after a targeted override clear', () => {
    const builtInDispatch = getHandler(handlerRegistry.fx, DISPATCH);
    const override = () => undefined;
    regEffect(DISPATCH, override);
    expect(getHandler(handlerRegistry.fx, DISPATCH)).toBe(override);

    handlerRegistry.fx.clear(DISPATCH);

    expect(getHandler(handlerRegistry.fx, DISPATCH)).toBe(builtInDispatch);
  });

  it('restores the default error handler after clearing a user override', () => {
    const override = () => undefined;
    regEventErrorHandler(override);
    expect(getHandler(handlerRegistry.error, 'event-handler')).toBe(override);

    handlerRegistry.error.clear('event-handler');

    expect(getHandler(handlerRegistry.error, 'event-handler')).toBe(defaultErrorHandler);
  });
});
