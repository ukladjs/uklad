/**
 * MCP Tool: dispatch_and_wait
 * Dispatch through the optional operation inspector and return its authoritative receipt.
 */

import { DevToolsAPIClient } from '../httpClient.js';
import {
  runtimeRoutingErrorResult,
  serverUnavailableResult,
} from './errorResponse.js';
import {
  runtimeIdInputProperty,
  runtimeMetadata,
  type RuntimeSelectionParams,
} from './runtimeSelection.js';

export interface DispatchAndWaitParams extends RuntimeSelectionParams {
  eventName: string;
  params?: any[];
}

export function dispatchAndWaitTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'dispatch_and_wait',
    description: 'Dispatch an event through Reflex Operations and wait until its full synchronous cascade has completed, the subscription graph has settled, and the authoritative post-dispatch receipt is available. The receipt includes every joined event, committed state patches, effect dispositions, state revisions, requested observations, and each subscription recalculated in the final publication wave. Requires the application to enable DevTools with createOperationInspector(runtime).',
    inputSchema: {
      type: 'object',
      properties: {
        eventName: {
          type: 'string',
          minLength: 1,
          maxLength: 256,
          description: 'The development event ID/name to execute.',
        },
        params: {
          type: 'array',
          maxItems: 100,
          description: 'Optional event parameters, excluding the event ID.',
          items: { type: ['string', 'number', 'boolean', 'object', 'array', 'null'] },
        },
        runtimeId: runtimeIdInputProperty,
      },
      required: ['eventName'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        runtimeId: { type: 'string' },
        runtimeName: { type: 'string' },
        sessionEpoch: { type: 'integer' },
        requestId: { type: 'string' },
        receipt: { type: 'object', additionalProperties: true },
      },
      required: ['receipt'],
      additionalProperties: true,
    },
    handler: async (params: DispatchAndWaitParams) => {
      try {
        const response = await apiClient.dispatchAndWait(
          params.eventName,
          params.params ?? [],
          params.runtimeId,
        );
        const result = {
          ...runtimeMetadata(response),
          ...(response.requestId ? { requestId: response.requestId } : {}),
          receipt: response.receipt,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        const unavailable = serverUnavailableResult(error, 'dispatch_and_wait');
        if (unavailable) return unavailable;
        const routing = runtimeRoutingErrorResult(error, 'dispatch_and_wait', params.runtimeId);
        if (routing) return routing;
        const details = (error as any)?.details ?? {};
        const unavailableCapability = (error as any)?.code === 'OPERATION_CAPABILITY_UNAVAILABLE';
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: unavailableCapability
                ? 'Operation receipt capability unavailable'
                : 'Failed to dispatch and await operation',
              code: (error as any)?.code,
              message: details.error ?? (error instanceof Error ? error.message : 'Unknown error'),
              event: params.eventName,
              hint: unavailableCapability
                ? 'Enable DevTools with createOperationInspector(runtime), then reconnect the runtime and retry.'
                : 'Make sure the DevTools server and operation-enabled app are running.',
            }, null, 2),
          }],
          isError: true,
        };
      }
    },
  };
}
