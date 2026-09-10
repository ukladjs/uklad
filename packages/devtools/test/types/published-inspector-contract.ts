import { createUkladInspector } from '@ukladjs/core/devtools';
import { enableDevtools, type UkladSubscriptionDiagnostic } from '@ukladjs/devtools';
import { enableDevtools as enableDevtoolsClient } from '@ukladjs/devtools/client';

// Resolve public package exports and built declarations, not workspace source.
declare const inspector: ReturnType<typeof createUkladInspector>;
enableDevtools(inspector, { enabled: false });
enableDevtoolsClient(inspector, { enabled: false });

export const externalKind: UkladSubscriptionDiagnostic['kind'] = 'external';
