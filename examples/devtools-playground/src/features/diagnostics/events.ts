import type { ReflexModule, ReflexRegistrar } from '@flexsurfer/reflex/vanilla';

import { appIds } from '../../app/reflex/catalog';
import type { AppContracts } from '../../app/reflex/contracts';

/**
 * Events that exist to produce interesting devtools traces.
 *
 * Nothing here belongs in a real application; it is the feature that
 * deliberately misbehaves so the inspector has something to show.
 */
export const registerDiagnosticsEvents: ReflexModule<ReflexRegistrar<AppContracts>> = (
  registrar,
) => {
  // The effect handler dispatches the follow-up event after this handler
  // commits, so the counter's state change appears as a child event in the
  // trace — and it lands in another feature's root, which is allowed.
  registrar.regEvent(appIds.events.diagnosticsDispatchFromEffect, () => {
    return [[appIds.effects.diagnosticsDispatchEvent, [appIds.events.counterEffectDispatched]]];
  });

  registrar.regEvent(appIds.events.diagnosticsSimulateError, () => {
    throw new Error('This is a simulated error for testing');
  });

  registrar.regEvent(
    appIds.events.diagnosticsEmitSink,
    ({ coeffects: { now } }) => {
      return [[appIds.effects.diagnosticsSink, now]];
    },
    { coeffects: { now: appIds.coeffects.systemNow } },
  );

  registrar.regEvent(appIds.events.diagnosticsBadParams, ({ draftState }, payload) => {
    draftState.diagnosticsPayload = payload;
  });

  /** Hands a live draft value to an effect, which devtools must render safely. */
  registrar.regEvent(appIds.events.diagnosticsImmerProxy, ({ draftState }) => {
    return [[appIds.effects.diagnosticsSink, draftState.diagnosticsImmerProbe]];
  });

  registrar.regEvent(appIds.events.diagnosticsWriteNested, ({ draftState }) => {
    draftState.diagnosticsNested = { label: 'test', child: { label: 'test2' } };
  });

  registrar.regEvent(appIds.events.diagnosticsCreateComplex, ({ draftState }) => {
    const projects = new Map<string, unknown>([
      [
        'project-1',
        {
          name: 'Website Redesign',
          members: new Set(['alice', 'bob', 'charlie']),
          tasks: new Map([
            ['task-1', { title: 'Design mockups', status: 'completed' }],
            ['task-2', { title: 'Implement frontend', status: 'in-progress' }],
          ]),
        },
      ],
      [
        'project-2',
        {
          name: 'API Development',
          members: new Set(['bob', 'diana']),
          tasks: new Map([
            ['task-3', { title: 'Design endpoints', status: 'completed' }],
            ['task-4', { title: 'Write documentation', status: 'pending' }],
          ]),
        },
      ],
    ]);

    const features = new Map<string, unknown>([
      ['dashboard', true],
      ['reports', false],
      ['analytics', new Set(['basic', 'advanced'])],
    ]);

    const settings = new Map<string, unknown>([
      ['theme', 'dark'],
      ['notifications', new Set(['email', 'push'])],
      ['features', features],
    ]);

    draftState.diagnosticsComplex = new Map<string, unknown>([
      ['projects', projects],
      ['settings', settings],
    ]);
  });
};
