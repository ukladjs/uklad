import { DISPATCH, DISPATCH_LATER } from '../index';
import { defaultErrorHandler } from '../events/pipeline';
import { clearHandlers, getHandler, regEffect, regEventErrorHandler } from './runtime-test-api';

describe('framework handler lifecycle', () => {
  it('restores built-in effects after a complete handler clear', () => {
    expect(getHandler('fx', DISPATCH)).toBeDefined();
    expect(getHandler('fx', DISPATCH_LATER)).toBeDefined();
    expect(getHandler('error', 'event-handler')).toBe(defaultErrorHandler);

    clearHandlers();

    expect(getHandler('fx', DISPATCH)).toBeDefined();
    expect(getHandler('fx', DISPATCH_LATER)).toBeDefined();
    expect(getHandler('error', 'event-handler')).toBe(defaultErrorHandler);
  });

  it('restores a built-in effect after a targeted override clear', () => {
    const builtInDispatch = getHandler('fx', DISPATCH);
    const override = () => undefined;
    regEffect(DISPATCH, override);
    expect(getHandler('fx', DISPATCH)).toBe(override);

    clearHandlers('fx', DISPATCH);

    expect(getHandler('fx', DISPATCH)).toBe(builtInDispatch);
  });

  it('restores the default error handler after clearing a user override', () => {
    const override = () => undefined;
    regEventErrorHandler(override);
    expect(getHandler('error', 'event-handler')).toBe(override);

    clearHandlers('error', 'event-handler');

    expect(getHandler('error', 'event-handler')).toBe(defaultErrorHandler);
  });
});
