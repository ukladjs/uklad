/**
 * MCP Tool: get_app_state
 * Retrieve current application database state
 */

import { DevToolsAPIClient } from '../httpClient.js';
import { serverUnavailableResult } from './errorResponse.js';

export interface GetAppStateParams {
  path?: string;
}

export function getAppStateTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'get_app_state',
    description: 'Retrieve current Reflex app-db state. Pass a path for a narrow slice; omit it only for intentionally small state because a full dump spends context. This does NOT include computed subscription values — use get_active_subs for mounted values.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          maxLength: 512,
          description: 'JSON path for one state slice (e.g., "user.profile" or "items[0]"). Strongly prefer this over an unscoped app-db dump.'
        },
      },
      additionalProperties: false
    },
    handler: async (params: GetAppStateParams) => {
      try {
        const response = await apiClient.getAppState(params.path);
        const state = response.state;

        if (state === null || state === undefined) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'No application state available. Make sure the app is connected to DevTools server.'
                }, null, 2)
              }
            ],
            isError: true
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                path: params.path || '(root)',
                state
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        const unavailable = serverUnavailableResult(error, 'get_app_state');
        if (unavailable) return unavailable;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Failed to fetch app state',
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
