import {
  isRegistrationCollisionError,
  REGISTRATION_COLLISION_CODE,
  RegistrationStore,
} from '../../src/runtime/registrations';

describe('RegistrationStore', () => {
  it('rejects duplicate ids and keeps stale handles from releasing a later registration', () => {
    const registrations = new RegistrationStore<() => string>();
    const firstHandler = () => 'first';
    const secondHandler = () => 'second';
    const first = registrations.register('shared', firstHandler);

    let collision: unknown;
    try {
      registrations.register('shared', secondHandler);
    } catch (error) {
      collision = error;
    }
    expect(isRegistrationCollisionError(collision)).toBe(true);
    expect(collision).toMatchObject({
      code: REGISTRATION_COLLISION_CODE,
      registrationId: 'shared',
      message: expect.stringContaining("Registration 'shared' is already registered"),
    });

    registrations.clear('shared');
    const second = registrations.register('shared', secondHandler);

    expect(first.active).toBe(false);
    expect(first.release()).toBe(false);
    expect(registrations.get('shared')).toBe(secondHandler);
    expect(second.release()).toBe(true);
    expect(registrations.get('shared')).toBeUndefined();
  });

  it('restores a system baseline when its explicit override is released', () => {
    const registrations = new RegistrationStore<() => string>();
    const baseline = () => 'baseline';
    const override = () => 'override';

    registrations.registerSystem('system', baseline);
    expect(() => registrations.register('system', override)).toThrow(
      "Registration 'system' is already registered",
    );

    const handle = registrations.registerSystemOverride('system', override);
    expect(registrations.get('system')).toBe(override);

    handle.release();
    expect(registrations.get('system')).toBe(baseline);
  });
});
