/**
 * MCP Tool: get_traces
 * Retrieve compact trace rows with filtering options.
 * Full detail for a single trace is available via get_trace.
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

export interface GetTracesParams extends RuntimeSelectionParams {
  limit?: number;
  eventFilter?: string;
  minDuration?: number;
  opType?: string;
}

export function getTracesTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'get_traces',
    description: 'List compact Uklad trace rows: events, subscription operations (create/run/dispose), and render cycles with timing. Use a small limit and eventFilter or opType before opening one get_trace row for patches, effects, or an error stack. To get current mounted subscription values, use get_active_subs.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of traces to return (default: 50, max: 1000)',
          minimum: 1,
          maximum: 1000
        },
        eventFilter: {
          type: 'string',
          maxLength: 256,
          description: 'Filter traces by event/operation name (case-insensitive substring match)'
        },
        minDuration: {
          type: 'number',
          description: 'Filter traces with duration >= this value (in milliseconds)',
          minimum: 0
        },
        opType: {
          type: 'string',
          description: 'Filter by operation type',
          enum: ['event', 'render', 'sub/create', 'sub/run', 'sub/dispose']
        },
        runtimeId: runtimeIdInputProperty,
      },
      additionalProperties: false
    },
    handler: async (params: GetTracesParams) => {
      try {
        const limit = params.limit && params.limit > 0 && params.limit <= 1000
          ? params.limit
          : 50;

        const response = await apiClient.getTraces({
          limit,
          eventFilter: params.eventFilter,
          minDuration: params.minDuration,
          opType: params.opType,
          ...(params.runtimeId === undefined
            ? {}
            : { runtimeId: params.runtimeId }),
        });

        const traces = response.traces || [];

        // Compact rows: identity, timing, event args, and outcome flags.
        // Fat tags (patches, effects, stacks) are get_trace territory.
        const formatted = traces.map((trace: any) => {
          const tags = trace.tags || {};
          return {
            id: trace.id,
            operation: trace.operation || 'unknown',
            opType: trace.opType || 'unknown',
            duration: trace.duration !== undefined ? trace.duration.toFixed(2) + 'ms' : 'N/A',
            timestamp: new Date(trace.start || 0).toISOString(),
            event: tags.event,
            query: tags.queryV,
            error: tags.error ? `${tags.error.phase}: ${tags.error.message}` : undefined,
            effectErrors: tags.effectErrorCount || undefined,
            // The client SDK serializes undefined as the string 'undefined'
            childOf: trace.childOf === 'undefined' ? undefined : trace.childOf
          };
        });

        // The server returns traces, stats, and runtime identity in one response
        // so a reconnect cannot mix rows from one epoch with counts from another.
        const stats = response.stats || {};

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...runtimeMetadata(response),
                summary: {
                  returned: formatted.length,
                  totalStored: stats.totalTraces || 0,
                  eventTraces: stats.eventTraces || 0,
                  renderTraces: stats.renderTraces || 0
                },
                traces: formatted
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        const unavailable = serverUnavailableResult(error, 'get_traces');
        if (unavailable) return unavailable;
        const routing = runtimeRoutingErrorResult(
          error,
          'get_traces',
          params.runtimeId,
        );
        if (routing) return routing;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Failed to fetch traces',
                message: error instanceof Error ? error.message : 'Unknown error',
                hint: 'Make sure the DevTools server is running'
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  };
}
