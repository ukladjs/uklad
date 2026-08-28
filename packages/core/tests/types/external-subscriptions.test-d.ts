import { createUkladRuntime } from '../../src/vanilla';
import type {
  ExternalSubscriptionContext,
  ExternalSubscriptionDriver,
  UkladContracts,
} from '../../src/vanilla';

interface ExternalContracts extends UkladContracts {
  state: { selected: string };
  coeffects: {};
  subscriptions: {
    source: { params: []; result: number };
    byId: { params: [id: number]; result: string };
    derived: { params: []; result: string };
  };
}

const runtime = createUkladRuntime<ExternalContracts>({
  initialState: { selected: 'source' },
  runtimeId: 'typed-external-subscriptions',
});

runtime.registerModule((registrar) => {
  registrar.regExternalSub(
    'source',
    () => [],
    () => {
      const contextCheck = (context: ExternalSubscriptionContext): void => {
        context.invalidate();
      };
      const driver: ExternalSubscriptionDriver<readonly [], number> = {
        read: () => 1,
        activate: (_inputs, context) => contextCheck(context),
        sync: () => {},
        dispose: () => {},
      };
      return driver;
    },
  );

  registrar.regExternalSub(
    'byId',
    (id) => {
      const checked: number = id;
      void checked;
      return [];
    },
    (id) => ({
      read: () => String(id),
      activate: () => {},
      sync: () => {},
      dispose: () => {},
    }),
  );

  registrar.regExternalSub(
    'derived',
    () => [['source']],
    () => ({
      read: ([value]) => String(value),
      activate: () => {},
      sync: () => {},
      dispose: () => {},
    }),
  );
});

runtime.registerModule((registrar) => {
  registrar.regExternalSub(
    'derived',
    // @ts-expect-error A dependency must name a declared subscription vector.
    () => [['missing']],
    () => ({
      read: () => 'derived',
      activate: () => {},
      sync: () => {},
      dispose: () => {},
    }),
  );
});

runtime.registerModule((registrar) => {
  registrar.regExternalSub(
    'source',
    () => [],
    () => ({
      // @ts-expect-error The external snapshot must match source.result.
      read: () => 'not-a-number',
      activate: () => {},
      sync: () => {},
      dispose: () => {},
    }),
  );
});

runtime.registerModule((registrar) => {
  registrar.regExternalSub(
    'derived',
    () => [['source']],
    () => ({
      // @ts-expect-error Dependency values follow the declared source result.
      read: ([value]: [string]) => value,
      activate: () => {},
      sync: () => {},
      dispose: () => {},
    }),
  );
});

runtime.registerModule((registrar) => {
  registrar.regExternalSub(
    // @ts-expect-error The id must be declared in the subscription contract.
    'unknown',
    () => [],
    () => ({
      read: () => undefined,
      activate: () => {},
      sync: () => {},
      dispose: () => {},
    }),
  );
});

void runtime;
