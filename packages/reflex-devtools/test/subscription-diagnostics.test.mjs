import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISPOSED_SUBSCRIPTION,
  diffSubscriptionDiagnostics,
} from '../dist/client/subscriptionDiagnostics.js';

function diagnostic(key, version, value, overrides = {}) {
  return {
    key,
    query: [key],
    kind: 'computed',
    active: true,
    version,
    status: 'value',
    value,
    ...overrides,
  };
}

test('emits only changed active root and computed subscriptions', () => {
  const versions = new Map();
  const diagnostics = [
    diagnostic('active', 1, { count: 1 }),
    diagnostic('root', 2, 'root', { kind: 'root' }),
    diagnostic('dormant', 3, 'dormant', { active: false }),
  ];

  assert.deepEqual(diffSubscriptionDiagnostics(diagnostics, versions), {
    active: { count: 1 },
    root: 'root',
  });
  assert.deepEqual(diffSubscriptionDiagnostics(diagnostics, versions), {});

  assert.deepEqual(diffSubscriptionDiagnostics([
    diagnostic('active', 4, { count: 2 }),
    diagnostics[1],
  ], versions), {
    active: { count: 2 },
  });
});

test('reports cached subscriptions that become inactive or disappear', () => {
  const versions = new Map();
  diffSubscriptionDiagnostics([
    diagnostic('inactive', 1, 1),
    diagnostic('removed', 2, 2),
  ], versions);

  assert.deepEqual(diffSubscriptionDiagnostics([
    diagnostic('inactive', 1, 1, { active: false }),
  ], versions), {
    inactive: DISPOSED_SUBSCRIPTION,
    removed: DISPOSED_SUBSCRIPTION,
  });
  assert.equal(versions.size, 0);
});

test('reset re-emits current values, disposes missing keys, and represents errors', () => {
  const versions = new Map();
  const diagnostics = [
    diagnostic('value', 1, undefined),
    diagnostic('failed', 2, undefined, { status: 'error', error: 'boom' }),
    diagnostic('removed', 3, 'old'),
  ];

  diffSubscriptionDiagnostics(diagnostics, versions);
  assert.deepEqual(diffSubscriptionDiagnostics(diagnostics, versions), {});
  assert.deepEqual(diffSubscriptionDiagnostics(diagnostics.slice(0, 2), versions, true), {
    value: undefined,
    failed: { '[SubscriptionError]': 'boom' },
    removed: DISPOSED_SUBSCRIPTION,
  });
});

test('an active empty diagnostic removes a previously published value', () => {
  const versions = new Map();
  diffSubscriptionDiagnostics([diagnostic('pending', 1, 'old')], versions);

  assert.deepEqual(diffSubscriptionDiagnostics([
    diagnostic('pending', 2, undefined, { status: 'empty' }),
  ], versions), {
    pending: DISPOSED_SUBSCRIPTION,
  });
  assert.equal(versions.size, 0);
});
