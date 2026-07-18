export const REFLEX_DEVTOOLS_PROTOCOL_VERSION = 2;
export const REFLEX_DEVTOOLS_PROTOCOL_HEADER =
  'reflex-devtools-protocol-version';
export const REFLEX_DEVTOOLS_CLIENT_HEADER = 'x-reflex-client';
export const REFLEX_DEVTOOLS_RUNTIME_ID_HEADER = 'x-reflex-runtime-id';
export const REFLEX_DEVTOOLS_RUNTIME_SESSION_HEADER = 'x-reflex-runtime-session';

export const REFLEX_DEVTOOLS_DEFAULT_RUNTIME_PAYLOAD_BYTES = 1024 * 1024;
export const REFLEX_DEVTOOLS_MAX_RUNTIME_PAYLOAD_BYTES = 8 * 1024 * 1024;

export const REFLEX_DEVTOOLS_RUNTIME_ERROR_TYPE = 'devtools-error';
export const REFLEX_DEVTOOLS_TELEMETRY_DROPPED_CODE =
  'RUNTIME_TELEMETRY_DROPPED';

export const REFLEX_DEVTOOLS_WS_PROTOCOL =
  `reflex-devtools.v${REFLEX_DEVTOOLS_PROTOCOL_VERSION}`;

export type DevtoolsCapability = 'inspect' | 'dispatch' | 'restore';
export type DevtoolsClientRole = 'runtime' | 'ui' | 'mcp';
export type DevtoolsRuntimeKind = 'browser' | 'headless' | 'react-native';
export type RuntimeTelemetryDropReason =
  | 'redaction-failed'
  | 'retention-limit';

/** Immutable identity supplied by the Reflex runtime that owns an inspector. */
export interface DevtoolsRuntimeIdentity {
  readonly runtimeId: string;
  readonly runtimeName: string;
}

/**
 * Compact runtime descriptor used by status and runtime-selection surfaces.
 * Additional runtime diagnostics remain part of the selected runtime's status.
 */
export interface DevtoolsRuntimeSummary extends DevtoolsRuntimeIdentity {
  readonly connected: boolean;
  readonly sessionEpoch: number;
  readonly runtime: DevtoolsRuntimeKind | null;
}

/**
 * Fixed-shape runtime notice. The server intentionally sends no rejected
 * value or exception detail back to the application process.
 */
export interface RuntimeTelemetryDroppedPayload {
  readonly code: typeof REFLEX_DEVTOOLS_TELEMETRY_DROPPED_CODE;
  readonly reason: RuntimeTelemetryDropReason;
  readonly eventType: string;
}

export interface RuntimeTelemetryDroppedNotice {
  readonly type: typeof REFLEX_DEVTOOLS_RUNTIME_ERROR_TYPE;
  readonly payload: RuntimeTelemetryDroppedPayload;
  readonly timestamp: number;
}

export interface DevtoolsProtocolInfo {
  readonly version: typeof REFLEX_DEVTOOLS_PROTOCOL_VERSION;
  readonly runtimeVersion: number | null;
  readonly inspectorApiVersion: number | null;
}
