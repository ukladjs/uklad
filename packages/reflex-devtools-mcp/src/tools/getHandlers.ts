/**
 * MCP Tool: get_handlers
 * List registered handlers in the Reflex application
 */

import { DevToolsAPIClient } from '../httpClient.js';
import { serverUnavailableResult } from './errorResponse.js';

export interface GetHandlersParams {
  type?: 'event' | 'fx' | 'cofx' | 'sub';
}

export function getHandlersTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'get_handlers',
    description: 'List registered Reflex handlers: event handlers, effects (fx), coeffects (cofx), and subscriptions (sub). Pass type whenever it is known to keep the runtime index small.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Filter by handler type',
          enum: ['event', 'fx', 'cofx', 'sub']
        }
      },
      additionalProperties: false
    },
    handler: async (params: GetHandlersParams) => {
      try {
        const response = await apiClient.getHandlers(params.type);
        const handlerKeys = response.handlerKeys;

        if (!handlerKeys) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'No handler information available',
                  message: 'Make sure the app is connected to DevTools server'
                }, null, 2)
              }
            ],
            isError: true
          };
        }

        // Build response based on filter
        const types = params.type ? [params.type] : ['event', 'fx', 'cofx', 'sub'];
        const result: Record<string, any> = {};

        for (const type of types) {
          const keys = handlerKeys[type as keyof typeof handlerKeys] || [];

          result[type] = {
            count: keys.length,
            handlers: keys.sort((a: string, b: string) => a.localeCompare(b))
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                handlers: result
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        const unavailable = serverUnavailableResult(error, 'get_handlers');
        if (unavailable) return unavailable;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Failed to fetch handlers',
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
