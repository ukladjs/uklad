import { enableMapSet } from '@flexsurfer/reflex';
import { saveSettings } from './utils/settingsStorage';
import { reflexReviver } from './utils/serialization';
import type { DevtoolsRuntimeSummary } from './types/Runtime';
import { dispatch, regEffect } from './runtime';

enableMapSet();

const PROTOCOL_VERSION = 2;
const WS_PROTOCOL = `reflex-devtools.v${PROTOCOL_VERSION}`;
const PROTOCOL_HEADER = 'Reflex-DevTools-Protocol-Version';

let wsConnection: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let capabilities = new Set<string>();
let sessionToken: string | null = null;
let sessionTokenSource: 'bootstrap' | 'configured' | null = null;

function isRuntimeSummary(value: unknown): value is DevtoolsRuntimeSummary {
  if (typeof value !== 'object' || value === null) return false;
  const runtime = value as Partial<DevtoolsRuntimeSummary>;
  return (
    typeof runtime.runtimeId === 'string'
    && typeof runtime.runtimeName === 'string'
    && typeof runtime.connected === 'boolean'
    && Number.isSafeInteger(runtime.sessionEpoch)
    && runtime.sessionEpoch! >= 0
    && (
      runtime.runtime === null
      || runtime.runtime === 'browser'
      || runtime.runtime === 'headless'
      || runtime.runtime === 'react-native'
    )
  );
}

function readRuntimeSummaries(value: unknown): DevtoolsRuntimeSummary[] | null {
  return Array.isArray(value) && value.every(isRuntimeSummary) ? value : null;
}

function isRuntimeIdentity(value: unknown): value is {
  runtimeId: string;
  runtimeName: string;
  sessionEpoch: number;
} {
  if (typeof value !== 'object' || value === null) return false;
  const identity = value as Record<string, unknown>;
  return typeof identity.runtimeId === 'string'
    && typeof identity.runtimeName === 'string'
    && Number.isSafeInteger(identity.sessionEpoch)
    && (identity.sessionEpoch as number) >= 1;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:127.')) return true;
  const octets = normalized.split('.');
  return octets.length === 4
    && octets[0] === '127'
    && octets.every((octet) =>
      /^\d{1,3}$/.test(octet)
      && Number(octet) >= 0
      && Number(octet) <= 255);
}

function endpointUrls(): { httpBase: string; wsUrl: string } {
  const configuredHost = import.meta.env.VITE_WS_HOST || window.location.host;
  const configured = /^https?:\/\//i.test(configuredHost)
    ? configuredHost
    : `${window.location.protocol}//${configuredHost}`;
  const url = new URL(configured);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(
      'The DevTools dashboard endpoint must be an http(s) URL without credentials, query, or fragment.',
    );
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new Error(
      'The DevTools dashboard refuses to send its token over remote plaintext HTTP. Use HTTPS or a loopback tunnel.',
    );
  }
  const httpBase = url.toString().replace(/\/+$/, '');
  return {
    httpBase,
    wsUrl: `${httpBase.replace(/^http/, 'ws')}/ui`,
  };
}

function tokenFromFragment(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('token');
  if (!token) return null;

  sessionToken = token;
  sessionTokenSource = 'configured';
  window.history.replaceState(
    null,
    document.title,
    `${window.location.pathname}${window.location.search}`,
  );
  return token;
}

async function getSessionToken(httpBase: string): Promise<string> {
  const fragmentToken = tokenFromFragment();
  if (fragmentToken) return fragmentToken;

  if (sessionToken) return sessionToken;

  const response = await fetch(`${httpBase}/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
      'X-Reflex-Client': 'reflex-devtools-ui',
    },
    body: JSON.stringify({ role: 'ui' }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (
    !response.ok
    || response.headers.get(PROTOCOL_HEADER) !== String(PROTOCOL_VERSION)
    || typeof body !== 'object'
    || body === null
    || !('token' in body)
    || typeof body.token !== 'string'
    || !('protocolVersion' in body)
    || body.protocolVersion !== PROTOCOL_VERSION
  ) {
    throw new Error('Could not authenticate the DevTools dashboard.');
  }

  sessionToken = body.token;
  sessionTokenSource = 'bootstrap';
  return body.token;
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectWebSocket();
  }, 3000);
}

async function connectWebSocket(): Promise<void> {
  let httpBase: string;
  let wsUrl: string;
  try {
    ({ httpBase, wsUrl } = endpointUrls());
  } catch (error) {
    console.error(error);
    return;
  }

  let token: string;
  try {
    token = await getSessionToken(httpBase);
  } catch (error) {
    console.error(error);
    scheduleReconnect();
    return;
  }

  const wsRef = new WebSocket(wsUrl, [WS_PROTOCOL]);
  wsConnection = wsRef;
  let authenticated = false;

  wsRef.onopen = () => {
    if (wsRef.protocol !== WS_PROTOCOL) {
      wsRef.close(1002, 'DevTools protocol negotiation failed');
      return;
    }
    wsRef.send(JSON.stringify({
      type: 'reflex-auth',
      payload: {
        role: 'ui',
        token,
        protocolVersion: PROTOCOL_VERSION,
      },
    }));
  };

  wsRef.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data, reflexReviver);
      if (data.type === 'devtools-connected') {
        const acceptedCapabilities = data.payload?.capabilities;
        const runtimes = readRuntimeSummaries(data.payload?.runtimes);
        if (
          authenticated
          || data.payload?.protocolVersion !== PROTOCOL_VERSION
          || runtimes === null
          || !Array.isArray(acceptedCapabilities)
          || !acceptedCapabilities.every((capability: unknown) =>
            capability === 'inspect'
            || capability === 'dispatch'
            || capability === 'restore')
        ) {
          wsRef.close(1002, 'DevTools protocol handshake failed');
          return;
        }
        authenticated = true;
        capabilities = new Set(acceptedCapabilities);
        dispatch(['set-capabilities', [...capabilities]]);
        dispatch(['set-connected', true]);
      } else if (!authenticated) {
        wsRef.close(1002, 'DevTools server sent data before authentication');
      } else if (data.type === 'devtools-error') {
        console.error(`[UI] ${data.payload?.code}: ${data.payload?.message}`);
        if (
          data.payload?.code === 'INVALID_RUNTIME_ID'
          || data.payload?.code === 'RUNTIME_NOT_FOUND'
          || data.payload?.code === 'RUNTIME_SELECTION_REQUIRED'
          || data.payload?.code === 'STALE_RUNTIME_SELECTION'
        ) {
          const runtimes = readRuntimeSummaries(data.payload?.runtimes);
          if (runtimes !== null) {
            dispatch([
              'runtime-selection-rejected',
              runtimes,
              typeof data.payload?.selectedRuntimeId === 'string'
                ? data.payload.selectedRuntimeId
                : null,
            ]);
          }
        }
      } else if (data.type === 'devtools-runtime-status') {
        const runtimes = readRuntimeSummaries(data.payload?.runtimes);
        if (runtimes === null) {
          wsRef.close(1002, 'DevTools server sent an invalid runtime list');
          return;
        }
        const selectedRuntimeId = data.payload?.selectedRuntimeId;
        if (selectedRuntimeId !== null && typeof selectedRuntimeId !== 'string') {
          wsRef.close(1002, 'DevTools server sent an invalid runtime selection');
          return;
        }
        dispatch(['set-runtimes', runtimes, selectedRuntimeId]);
      } else if (data.type === 'devtools-runtime-selected') {
        if (!isRuntimeIdentity(data.payload)) {
          wsRef.close(1002, 'DevTools server sent an invalid runtime selection acknowledgement');
          return;
        }
        dispatch(['runtime-selected', data.payload]);
      } else if (data.type === 'reflex-traces') {
        dispatch(['add-traces', data.payload, data.runtimeId, data.sessionEpoch]);
      } else if (data.type === 'reflex-state') {
        dispatch(['update-state', data.payload, data.runtimeId, data.sessionEpoch]);
      } else if (data.type === 'reflex-active-subs') {
        dispatch(['update-active-subs', data.payload, data.runtimeId, data.sessionEpoch]);
      } else if (data.type === 'reflex-handler-keys') {
        dispatch(['update-handler-keys', data.payload, data.runtimeId, data.sessionEpoch]);
      }
    } catch (error) {
      console.error('Error parsing DevTools event:', error);
    }
  };

  wsRef.onclose = () => {
    if (wsConnection === wsRef) wsConnection = null;
    capabilities.clear();
    dispatch(['set-capabilities', []]);
    dispatch(['set-runtimes', []]);
    dispatch(['set-connected', false]);

    if (sessionTokenSource === 'bootstrap') {
      sessionToken = null;
      sessionTokenSource = null;
    }
    scheduleReconnect();
  };

  wsRef.onerror = () => {
    // The close handler owns retry and deliberately avoids echoing auth data.
  };
}

regEffect('init-socket', () => {
  void connectWebSocket();
});

regEffect('save-settings', (settings) => {
  saveSettings(settings);
});

regEffect('send-runtime-selection', (runtimeId: string) => {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
    console.error('[UI] WebSocket is not connected.');
    return;
  }
  wsConnection.send(JSON.stringify({
    type: 'select-runtime',
    payload: { runtimeId },
  }));
});

regEffect(
  'send-dispatch-to-client',
  (payload: { runtimeId: string | null; eventName: string; params: any[] }) => {
    if (!capabilities.has('dispatch')) {
      console.error('[UI] DevTools is read-only; dispatch is not granted.');
      return;
    }
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      console.error('[UI] WebSocket is not connected.');
      return;
    }
    if (!payload.runtimeId) {
      console.error('[UI] Select a runtime before dispatching.');
      return;
    }

    try {
      wsConnection.send(JSON.stringify({
        type: 'dispatch-to-client',
        payload,
      }));
    } catch {
      console.error('[UI] Could not send the dispatch request.');
    }
  },
);
