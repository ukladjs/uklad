/**
 * MCP Tool: dispatch_and_wait
 * Dispatch through the optional coordinator capability and return its snapshot.
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
    description: 'Dispatch an event through the DevTools-owned operation coordinator and wait for its settled snapshot. The snapshot includes operation/runtime identity, completion boundary, joined-event lineage and IDs, state dispositions and revisions, effect/error summary, pending work, and execution errors. State patches are present only when the app enables operations.evidence.stateChanges: "patches". Requires enableDevtools(createUkladInspector(runtime), { operations: true }).',
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
        operation: {
          type: 'object',
          description: 'Current DevTools snapshots use schemaVersion 0. New fields are additive so compatible older runtimes may omit them.',
          properties: {
            schemaVersion: { type: 'integer', enum: [0] },
            runtimeInstanceId: { type: 'string' },
            completion: { type: 'string', enum: ['cascade-published'] },
            operationId: { type: 'string' },
            rootEventInstanceId: { type: 'string' },
            acceptedSequence: { type: 'integer' },
            status: {
              type: 'string',
              enum: [
                'queued',
                'running',
                'publishing',
                'completed',
                'completed-with-errors',
                'rejected',
                'failed',
              ],
            },
            evidence: {
              type: 'object',
              properties: {
                stateChanges: { type: 'string', enum: ['none', 'patches'] },
                retainedStatePatchCount: { type: 'integer' },
                statePatchesTruncated: { type: 'boolean' },
              },
              additionalProperties: true,
            },
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  eventInstanceId: { type: 'string' },
                  eventId: { type: 'string' },
                  stateStatus: {
                    type: 'string',
                    enum: ['committed', 'unchanged', 'skipped'],
                  },
                  statePatches: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        op: { type: 'string', enum: ['add', 'remove', 'replace'] },
                        path: {
                          type: 'array',
                          items: { type: ['string', 'integer'] },
                        },
                        value: {},
                      },
                      additionalProperties: true,
                    },
                  },
                  statePatchesTruncated: { type: 'boolean' },
                },
                additionalProperties: true,
              },
            },
            summary: {
              type: 'object',
              properties: {
                eventCount: { type: 'integer' },
                state: { type: 'object', additionalProperties: true },
                effects: { type: 'object', additionalProperties: true },
                errorCount: { type: 'integer' },
              },
              additionalProperties: true,
            },
            hasDetachedEffects: { type: 'boolean' },
          },
          additionalProperties: true,
        },
      },
      required: ['operation'],
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
          operation: response.operation,
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
                ? 'Operation snapshot capability unavailable'
                : 'Failed to dispatch and await operation',
              code: (error as any)?.code,
              message: details.error ?? (error instanceof Error ? error.message : 'Unknown error'),
              event: params.eventName,
              hint: unavailableCapability
                ? 'Enable DevTools with enableDevtools(createUkladInspector(runtime), { operations: true }), then reconnect the runtime and retry.'
                : 'Make sure the DevTools server and operation-enabled app are running.',
            }, null, 2),
          }],
          isError: true,
        };
      }
    },
  };
}
