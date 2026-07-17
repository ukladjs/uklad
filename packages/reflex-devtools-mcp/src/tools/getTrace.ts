/**
 * MCP Tool: get_trace
 * Retrieve one trace with full detail (minus reversePatches)
 */

import { DevToolsAPIClient } from '../httpClient.js';
import { serverUnavailableResult } from './errorResponse.js';

export interface GetTraceParams {
  id: number;
}

export function getTraceTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'get_trace',
    description: 'Get the full detail of a single trace by id (from a get_traces row): for events, the state patches committed, the effects emitted, and error details (message, stack, failing interceptor) if it failed; for subscription runs, the query vector and cache info.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'integer',
          minimum: 0,
          description: 'The trace id, as returned by get_traces'
        }
      },
      required: ['id'],
      additionalProperties: false
    },
    handler: async (params: GetTraceParams) => {
      try {
        const response = await apiClient.getTrace(params.id);
        const trace = response.trace;

        // Agents never time-travel; reversePatches only add bulk
        if (trace?.tags?.reversePatches) {
          delete trace.tags.reversePatches;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ trace }, null, 2)
            }
          ]
        };
      } catch (error) {
        const unavailable = serverUnavailableResult(error, 'get_trace');
        if (unavailable) return unavailable;

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
