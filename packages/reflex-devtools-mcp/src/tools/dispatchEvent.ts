/**
 * MCP Tool: dispatch_event
 * Dispatch events to the client application and report the observed outcome
 */

import { DevToolsAPIClient } from '../httpClient.js';
import { serverUnavailableResult } from './errorResponse.js';

export interface DispatchEventParams {
  eventName: string;
  params?: any[];
}

export function dispatchEventTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'dispatch_event',
    description: 'Dispatch an event to the Reflex application and observe what it did. Returns the outcome derived from the event\'s trace: "succeeded" (with the state patches it committed and the effects it emitted), "failed" (with the error — a missing handler or a throwing handler chain), or "effects-failed" (state committed, but some effect handlers threw). Use this as an act-and-verify loop: the response is the state diff, no follow-up trace query needed.',
    inputSchema: {
      type: 'object',
      properties: {
        eventName: {
          type: 'string',
          description: 'The event ID/name to dispatch (e.g., "set-user", "fetch-data")'
        },
        params: {
          type: 'array',
          description: 'Optional array of parameters to pass to the event handler',
          items: {
            type: ['string', 'number', 'boolean', 'object', 'array', 'null']
          }
        }
      },
      required: ['eventName']
    },
    handler: async (params: DispatchEventParams) => {
      try {
        const eventParams = params.params || [];
        const response = await apiClient.dispatchEvent(params.eventName, eventParams);

        const result: Record<string, any> = {
          outcome: response.outcome,
          event: params.eventName,
          params: eventParams
        };

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
