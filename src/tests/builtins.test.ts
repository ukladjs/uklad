import { DISPATCH, DISPATCH_LATER, NOW, RANDOM, regEffect } from '../index';
import { clearHandlers, getHandler } from '../registrar';

describe('framework handler lifecycle', () => {
  it('restores built-in effects and coeffects after a complete handler clear', () => {
    expect(getHandler('fx', DISPATCH)).toBeDefined();
    expect(getHandler('fx', DISPATCH_LATER)).toBeDefined();
    expect(getHandler('cofx', NOW)).toBeDefined();
    expect(getHandler('cofx', RANDOM)).toBeDefined();

    clearHandlers();

    expect(getHandler('fx', DISPATCH)).toBeDefined();
    expect(getHandler('fx', DISPATCH_LATER)).toBeDefined();
    expect(getHandler('cofx', NOW)).toBeDefined();
    expect(getHandler('cofx', RANDOM)).toBeDefined();
  });

  it('restores a built-in effect after a targeted override clear', () => {
    const builtInDispatch = getHandler('fx', DISPATCH);
    const override = () => undefined;
    regEffect(DISPATCH, override);
    expect(getHandler('fx', DISPATCH)).toBe(override);

    clearHandlers('fx', DISPATCH);

    expect(getHandler('fx', DISPATCH)).toBe(builtInDispatch);
  });
});
