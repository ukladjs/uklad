/**
 * MCP Tool: get_active_subs
 * View currently active subscriptions
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

export interface GetActiveSubsParams extends RuntimeSelectionParams {
  filter?: string;
}

export function getActiveSubsTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'get_active_subs',
    description: 'Get all active subscriptions in the Uklad application, including mounted root subscriptions and active dependencies. Use filter to keep the response narrow.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          maxLength: 256,
          description: 'Optional filter to match subscription keys (case-insensitive substring match)'
        },
        runtimeId: runtimeIdInputProperty,
      },
      additionalProperties: false
    },
    handler: async (params: GetActiveSubsParams) => {
      try {
        const response = await apiClient.getSubscriptions(
          params.filter,
          params.runtimeId,
        );
        const activeSubs = response.subscriptions || {};

        // Format subscriptions
        const subscriptions = Object.entries(activeSubs).map(([key, value]) => ({
          key,
          value
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...runtimeMetadata(response),
                summary: {
                  total: response.total ?? Object.keys(activeSubs).length,
                  filtered: subscriptions.length
                },
                subscriptions
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        const unavailable = serverUnavailableResult(error, 'get_active_subs');
        if (unavailable) return unavailable;
        const routing = runtimeRoutingErrorResult(
          error,
          'get_active_subs',
          params.runtimeId,
        );
        if (routing) return routing;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Failed to fetch active subscriptions',
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
