/**
 * MCP Tool: app_status
 * Cheap health/session check — the first call after a cold start or reload
 */

import { DevToolsAPIClient } from '../httpClient.js';
import { serverUnavailableResult } from './errorResponse.js';

export function appStatusTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'app_status',
    description: 'Cheap health check for the whole loop — call it first after a cold start and after any app reload. Reports whether an app is connected and how it runs (runtime "browser", "react-native", or "headless" plus its side-effect adapter modes), whether tracing is on, registered handler counts, and sessionEpoch — a counter that bumps every time the app reconnects. If sessionEpoch changed since you last looked, the app restarted: trace ids reset, stored traces cleared, and previously seeded state is gone.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    handler: async () => {
      try {
        const response = await apiClient.getStatus();

        const status: Record<string, any> = {
          appConnected: response.appConnected,
          sessionEpoch: response.sessionEpoch,
          mcpEnabled: response.mcpEnabled,
          runtime: response.runtime,
          tracing: response.tracing,
          handlers: response.handlers,
          stateAvailable: response.stateAvailable,
          traceCount: response.traceCount,
          capabilities: response.capabilities,
          readOnly: response.readOnly,
          protocol: response.protocol,
          security: response.security
        };
        if (response.effectMode != null) status.effectMode = response.effectMode;
        if (response.effects != null) status.effects = response.effects;
        if (response.connectedApps > 1) status.connectedApps = response.connectedApps;

        const hints: string[] = [];
        if (!response.mcpEnabled) {
          hints.push('The devtools server was started without --mcp: MCP inspection storage is disabled. Restart the project-local `devtools:mcp` script (for example, `npm run devtools:mcp`).');
        }
        if (!response.appConnected) {
          hints.push('No app is connected. Start one — a browser tab, or a headless state runtime (a src/headless.ts entry run under tsx/vite-node) for browserless work.');
        } else if (response.runtime == null && response.mcpEnabled) {
          hints.push('The connected app has not reported runtime info — its @flexsurfer/reflex-devtools SDK likely predates runtime reporting.');
        } else if (response.tracing === false) {
          hints.push('Tracing is off in the app, so dispatch outcomes will come back "unknown". Open the devtools UI or restart the server with --mcp to keep tracing on.');
        }
        if (!response.capabilities?.includes('dispatch')) {
          hints.push('DevTools is read-only. Restart it with --allow-dispatch only when an agent should be allowed to mutate app state.');
        }
        if (hints.length > 0) status.hints = hints;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(status, null, 2)
            }
          ]
        };
      } catch (error) {
        const unavailable = serverUnavailableResult(error, 'app_status');
        if (unavailable) return unavailable;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Failed to fetch app status',
                message: error instanceof Error ? error.message : 'Unknown error',
                hint: 'The devtools server itself is unreachable — start the project-local `devtools:mcp` script (for example, `npm run devtools:mcp`)'
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  };
}
