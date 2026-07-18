import {
  devToolsServerUnavailableBody,
  isDevToolsServerUnavailableError
} from '../httpClient.js';

export function serverUnavailableResult(error: unknown, retryTool: string) {
  if (!isDevToolsServerUnavailableError(error)) return null;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(devToolsServerUnavailableBody(retryTool), null, 2)
      }
    ],
    isError: true
  };
}

const RUNTIME_ROUTING_CODES = new Set([
  'INVALID_RUNTIME_ID',
  'RUNTIME_NOT_FOUND',
  'RUNTIME_SELECTION_REQUIRED',
  'SESSION_EPOCH_MISMATCH',
]);

export function runtimeRoutingErrorResult(
  error: unknown,
  tool: string,
  requestedRuntimeId?: string,
) {
  const code = (error as any)?.code;
  if (!RUNTIME_ROUTING_CODES.has(code)) return null;

  const details = (error as any)?.details ?? {};
  const hint = code === 'RUNTIME_SELECTION_REQUIRED'
    ? 'Call app_status to list runtimes, then retry this tool with runtimeId.'
    : code === 'SESSION_EPOCH_MISMATCH'
      ? 'The DevTools session changed. Discard trace ids from the old epoch, call get_traces again, and use its new sessionEpoch.'
      : 'Call app_status to refresh the runtime list, then retry with a listed runtimeId.';

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: details.error ?? (error instanceof Error ? error.message : 'Runtime selection failed'),
          code,
          tool,
          requestedRuntimeId: requestedRuntimeId ?? null,
          selectedRuntimeId: details.selectedRuntimeId ?? null,
          expectedSessionEpoch: details.expectedSessionEpoch,
          sessionEpoch: details.sessionEpoch,
          runtimes: details.runtimes ?? [],
          hint,
        }, null, 2),
      },
    ],
    isError: true,
  };
}
