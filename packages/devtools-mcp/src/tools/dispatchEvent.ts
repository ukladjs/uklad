/**
 * MCP Tool: dispatch_event
 * Dispatch events to the client application and report the observed outcome
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

export interface DispatchEventParams extends RuntimeSelectionParams {
  eventName: string;
  params?: any[];
}

export function dispatchEventTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'dispatch_event',
    description: 'Dispatch an event to the Uklad application and observe what it did. Returns the outcome derived from the event\'s trace: "succeeded" (with the state patches it committed and the effects it emitted), "failed" (with the error — a missing handler or a throwing handler chain), or "effects-failed" (state committed, but some effect handlers threw). Use this as an act-and-verify loop: the response is the state diff, no follow-up trace query needed. This is the only mutating tool: it requires the DevTools server to run with --allow-dispatch, and otherwise returns a CAPABILITY_DENIED error the user must resolve by restarting the server with that flag.',
    inputSchema: {
      type: 'object',
      properties: {
        eventName: {
          type: 'string',
          minLength: 1,
          maxLength: 256,
          description: 'The event ID/name to dispatch (e.g., "set-user", "fetch-data")'
        },
        params: {
          type: 'array',
          maxItems: 100,
          description: 'Optional array of parameters to pass to the event handler',
          items: {
            type: ['string', 'number', 'boolean', 'object', 'array', 'null']
          }
        },
        runtimeId: runtimeIdInputProperty,
      },
      required: ['eventName'],
      additionalProperties: false
    },
    handler: async (params: DispatchEventParams) => {
      try {
        const eventParams = params.params || [];
        const response = await apiClient.dispatchEvent(
          params.eventName,
          eventParams,
          params.runtimeId,
        );

        const result: Record<string, any> = {
          ...runtimeMetadata(response),
          outcome: response.outcome,
          event: params.eventName
        };
        if (response.requestId) result.auditRequestId = response.requestId;

        if (response.outcome === 'succeeded') {
          result.duration = response.duration !== undefined ? `${response.duration}ms` : undefined;
          result.stateChanges = response.patches;
          result.effectsEmitted = response.effects;
          result.traceId = response.traceId;
        } else if (response.outcome === 'failed') {
          result.error = response.error;
          result.hint = response.error?.phase === 'missing-handler'
            ? 'No handler is registered for this event id — check get_handlers for the exact spelling'
            : 'The handler chain threw; state was not committed';
          result.traceId = response.traceId;
        } else if (response.outcome === 'effects-failed') {
          result.duration = response.duration !== undefined ? `${response.duration}ms` : undefined;
          result.stateChanges = response.patches;
          result.effectsEmitted = response.effects;
          result.effectErrors = response.effectErrors;
          result.hint = 'The event committed its state changes, but some effect handlers threw';
          result.traceId = response.traceId;
        } else {
          // 'unknown' — dispatched but unobserved (timeout, tracing off, app disconnect)
          result.message = response.message;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        const unavailable = serverUnavailableResult(error, 'dispatch_event');
        if (unavailable) return unavailable;
        const routing = runtimeRoutingErrorResult(
          error,
          'dispatch_event',
          params.runtimeId,
        );
        if (routing) return routing;

        if ((error as any)?.code === 'CAPABILITY_DENIED') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Capability denied',
                  code: 'CAPABILITY_DENIED',
                  tool: 'dispatch_event',
                  requestedRuntimeId: params.runtimeId ?? null,
                  event: params.eventName,
                  message:
                    'The DevTools server is running read-only, so this event ' +
                    'was not dispatched and app state was not changed. Dispatch ' +
                    'requires the server to be started with --allow-dispatch. ' +
                    'Ask the user to restart it with that flag only if mutating ' +
                    'app state is intended; do not work around this boundary.',
                }, null, 2),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Failed to dispatch event',
                message: error instanceof Error ? error.message : 'Unknown error',
                event: params.eventName,
                hint: 'Make sure the DevTools server and app are running'
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  };
}
