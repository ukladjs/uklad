import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createKeyRedactor,
  redactDevtoolsEvent,
} from '../dist/redaction.js';
import { ukladReplacer } from '../dist/serialization.js';

function syntheticCredentials() {
  return {
    provider: ['sk', 'proj', 'A'.repeat(24)].join('-'),
    cloudAccessId: `AKIA${'B'.repeat(16)}`,
    jwt: [
      `eyJ${'a'.repeat(12)}`,
      'b'.repeat(16),
      'c'.repeat(16),
    ].join('.'),
    bearer: 'D'.repeat(24),
  };
}

test('default key redaction covers token naming styles without broad token false positives', () => {
  const marker = 'synthetic-sensitive-marker';
  const source = {
    token: marker,
    access_token: marker,
    refresh_tokens: marker,
    accessToken: marker,
    accessTokenValue: marker,
    refreshToken: marker,
    idToken: marker,
    authTokens: marker,
    AccessToken: marker,
    JWTToken: marker,
    AUTHToken: marker,
    tokenizer: 'word-piece',
    tokenCount: 42,
    retokenize: true,
    values: new Map([
      ['apiToken', marker],
      ['tokenCount', 7],
    ]),
    patches: [
      { op: 'replace', path: ['session', 'csrfToken'], value: marker },
      { op: 'replace', path: ['metrics', 'tokenCount'], value: 9 },
    ],
  };

  const redacted = createKeyRedactor()(source);

  for (const key of [
    'token',
    'access_token',
    'refresh_tokens',
    'accessToken',
    'accessTokenValue',
    'refreshToken',
    'idToken',
    'authTokens',
    'AccessToken',
    'JWTToken',
    'AUTHToken',
  ]) {
    assert.equal(redacted[key], '[REDACTED]');
  }
  assert.equal(redacted.tokenizer, 'word-piece');
  assert.equal(redacted.tokenCount, 42);
  assert.equal(redacted.retokenize, true);
  assert.equal(redacted.values.get('apiToken'), '[REDACTED]');
  assert.equal(redacted.values.get('tokenCount'), 7);
  assert.equal(redacted.patches[0].value, '[REDACTED]');
  assert.equal(redacted.patches[1].value, 9);

  assert.equal(source.accessToken, marker);
  assert.equal(source.values.get('apiToken'), marker);
  assert.equal(source.patches[0].value, marker);
});

test('raw Errors are normalized and scrubbed before Error.toJSON can run', () => {
  const credentials = syntheticCredentials();
  const error = new Error(
    `Ordinary failure detail; provider ${credentials.provider}; cloud ${credentials.cloudAccessId}; jwt ${credentials.jwt}`,
  );
  error.stack = [
    `Error: ordinary stack detail; Authorization: Bearer ${credentials.bearer}`,
    'at saveRecord (file:///workspace/app.js:12:4)',
    `at connect (postgres://developer:synthetic-password@localhost/example)`,
  ].join('\n');

  let toJSONCalls = 0;
  Object.defineProperty(error, 'toJSON', {
    value() {
      toJSONCalls += 1;
      return { message: credentials.provider };
    },
  });

  const redacted = createKeyRedactor()({ failure: error });
  const serialized = JSON.stringify(redacted, ukladReplacer);
  const details = redacted.failure['[Error]'];

  assert.equal(toJSONCalls, 0);
  assert.equal(details.name, 'Error');
  assert.match(details.message, /^Ordinary failure detail;/);
  assert.match(details.stack, /at saveRecord/);
  assert.match(details.message, /\[REDACTED:CREDENTIAL\]/);
  assert.match(details.stack, /\[REDACTED:CREDENTIAL\]/);
  for (const credential of Object.values(credentials)) {
    assert.equal(serialized.includes(credential), false);
  }
  assert.equal(serialized.includes('synthetic-password'), false);
});

test('structured errors are scrubbed after custom hooks across devtools event paths', () => {
  const credentials = syntheticCredentials();
  let structuredToJSONCalls = 0;
  const noOpRedaction = {
    state: (value) => value,
    trace: (value) => value,
  };
  const traceEvent = redactDevtoolsEvent(
    {
      type: 'uklad-traces',
      payload: [{
        tags: {
          error: {
            phase: 'handler',
            message: `Handler failed normally with Basic authentication: ${credentials.provider}`,
            stack: `Error: Handler failed normally: ${credentials.jwt}`,
            toJSON() {
              structuredToJSONCalls += 1;
              return { message: credentials.provider };
            },
          },
          effectErrors: [{
            phase: 'effect',
            effect: 'persist',
            message: `Persistence failed; apiKey=${credentials.cloudAccessId}`,
          }],
          note: credentials.provider,
        },
      }],
    },
    noOpRedaction,
    'runtime',
  );
  const evalEvent = redactDevtoolsEvent(
    {
      type: 'uklad-eval-sub-result',
      payload: {
        evalId: 'eval-1',
        error: {
          phase: 'evaluation',
          message: `Evaluation failed normally: ${credentials.cloudAccessId}`,
        },
      },
    },
    noOpRedaction,
    'runtime',
  );
  const subscriptionEvent = redactDevtoolsEvent(
    {
      type: 'uklad-active-subs',
      payload: {
        account: {
          '[SubscriptionError]': `Subscription failed normally: ${credentials.jwt}`,
        },
      },
    },
    noOpRedaction,
    'runtime',
  );

  assert.match(
    traceEvent.payload[0].tags.error.message,
    /^Handler failed normally with Basic authentication: \[REDACTED:CREDENTIAL\]$/,
  );
  assert.match(
    traceEvent.payload[0].tags.error.stack,
    /\[REDACTED:CREDENTIAL\]/,
  );
  assert.match(
    traceEvent.payload[0].tags.effectErrors[0].message,
    /apiKey=\[REDACTED:CREDENTIAL\]/,
  );
  assert.match(
    evalEvent.payload.error.message,
    /\[REDACTED:CREDENTIAL\]/,
  );
  assert.match(
    subscriptionEvent.payload.account['[SubscriptionError]'],
    /\[REDACTED:CREDENTIAL\]/,
  );
  assert.equal(traceEvent.payload[0].tags.error.toJSON, '[Function]');
  JSON.stringify(traceEvent);
  assert.equal(structuredToJSONCalls, 0);

  // High-confidence content scanning is intentionally limited to recognized
  // error fields; arbitrary application strings remain the hook's policy.
  assert.equal(traceEvent.payload[0].tags.note, credentials.provider);
});

test('error text is bounded before scanning and incomplete credentials are removed', () => {
  const credentials = syntheticCredentials();
  const partialPrivateKey = [
    '-----BEGIN PRIVATE KEY-----',
    'E'.repeat(400),
  ].join('\n');
  const message = [
    'Ordinary prefix',
    'x'.repeat(3_950),
    `apiKey="quoted value ${credentials.provider}`,
    'y'.repeat(500),
  ].join(' ');
  const stack = [
    'Error: ordinary stack prefix',
    'z'.repeat(32_400),
    partialPrivateKey,
    'tail that is outside the retained bound',
  ].join('\n');
  const error = new Error(message);
  error.stack = stack;

  const redacted = createKeyRedactor()(error)['[Error]'];

  assert.equal(redacted.message.length <= 4 * 1024, true);
  assert.equal(redacted.stack.length <= 32 * 1024, true);
  assert.match(redacted.message, /\[TRUNCATED\]$/);
  assert.match(redacted.stack, /\[TRUNCATED\]$/);
  assert.equal(redacted.message.includes(credentials.provider), false);
  assert.equal(redacted.message.includes('quoted value'), false);
  assert.equal(redacted.stack.includes('-----BEGIN PRIVATE KEY-----'), false);
  assert.equal(redacted.stack.includes('E'.repeat(32)), false);
});
