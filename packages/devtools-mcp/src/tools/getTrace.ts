/**
 * MCP Tool: get_trace
 * Retrieve one trace with full detail (minus reversePatches)
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

export interface GetTraceParams extends RuntimeSelectionParams {
  id: number;
  sessionEpoch?: number;
}

export function getTraceTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'get_trace',
    description: 'Get the full detail of a single trace by id (from a get_traces row). Pass that response\'s sessionEpoch to fail explicitly if the DevTools session changed before lookup. For events, returns committed state patches, emitted effects, and failure details; for subscription runs, the query vector and cache info.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'integer',
          minimum: 0,
          description: 'The trace id, as returned by get_traces'
        },
        runtimeId: runtimeIdInputProperty,
        sessionEpoch: {
          type: 'integer',
          minimum: 1,
          description:
            'Expected session epoch from get_traces. The lookup fails with SESSION_EPOCH_MISMATCH if that DevTools session changed.',
        },
      },
      required: ['id'],
      additionalProperties: false
    },
    handler: async (params: GetTraceParams) => {
      try {
        const response = await apiClient.getTrace(
          params.id,
          params.runtimeId,
          params.sessionEpoch,
        );
        const trace = response.trace;

        // Agents never time-travel; reversePatches only add bulk
        if (trace?.tags?.reversePatches) {
          delete trace.tags.reversePatches;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...runtimeMetadata(response),
                trace,
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        const unavailable = serverUnavailableResult(error, 'get_trace');
        if (unavailable) return unavailable;
        const routing = runtimeRoutingErrorResult(
          error,
          'get_trace',
          params.runtimeId,
        );
        if (routing) return routing;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Failed to fetch trace',
                id: params.id,
                message: error instanceof Error ? error.message : 'Unknown error',
                hint: 'Trace ids come from get_traces; storage resets when the app reconnects'
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  };
}
