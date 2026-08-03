import type { UkladModule, UkladRegistrar } from '@ukladjs/core/vanilla';

import { appIds } from '../../app/uklad/catalog';
import type { AppContracts } from '../../app/uklad/contracts';
import { COUNTER_STORAGE_KEY } from './state';

export const registerCounterEvents: UkladModule<UkladRegistrar<AppContracts>> = (registrar) => {
  registrar.regEvent(appIds.events.counterIncrement, ({ draftState }) => {
    draftState.counterValue += 1;
  });

  // Dispatched by the `diagnostics/dispatch-event` effect, not by any view.
  // Cross-feature dispatch is valid: a prefix marks ownership, not access.
  registrar.regEvent(appIds.events.counterEffectDispatched, ({ draftState }) => {
    draftState.counterEffectDispatches += 1;
  });

  // The persist/load pair is what exercises the platform adapter split. These
  // handlers only emit and consume the effect and coeffect contracts; whether
  // that reaches window.localStorage or an in-memory map is decided by which
  // platform module the entry point installed.
  registrar.regEvent(appIds.events.counterPersist, ({ draftState }) => {
    return [
      [appIds.effects.storageLocalSet, { key: COUNTER_STORAGE_KEY, value: draftState.counterValue }],
      [appIds.effects.documentTitle, `Counter: ${draftState.counterValue}`],
    ];
  });

  registrar.regEvent(
    appIds.events.counterLoad,
    ({ draftState, coeffects: { stored } }) => {
      if (stored != null) {
        draftState.counterValue = JSON.parse(stored);
      }
    },
    { coeffects: { stored: [appIds.coeffects.storageLocalValue, COUNTER_STORAGE_KEY] } },
  );
};
