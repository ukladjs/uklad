/**
 * MCP Tool: app_status
 * Cheap health/session check — the first call after a cold start or reload
 */

import { DevToolsAPIClient } from '../httpClient.js';
import {
  runtimeRoutingErrorResult,
  serverUnavailableResult,
} from './errorResponse.js';
import {
  runtimeIdInputProperty,
  type RuntimeSelectionParams,
} from './runtimeSelection.js';

export function appStatusTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'app_status',
    description: 'Cheap health and runtime-discovery check — call it first after a cold start and after any app reload. Lists every known runtime and its stable runtimeId. Pass runtimeId to select one when multiple runtimes are connected. Reports how the selected runtime runs ("browser", "react-native", or "headless"), current committed/published state revisions, tracing, handler counts, operation capability/evidence mode, and sessionEpoch. If sessionEpoch changed, its DevTools connection session changed and server-stored trace ids were invalidated; a transient reconnect can leave runtime state intact.',
    inputSchema: {
      type: 'object',
      properties: {
        runtimeId: runtimeIdInputProperty,
      },
      additionalProperties: false
    },
    handler: async (params: RuntimeSelectionParams) => {
      try {
        const response = await apiClient.getStatus(params.runtimeId);
        const selectedRuntimeId =
          response.selectedRuntimeId ?? response.runtimeId ?? null;
        const runtimes = Array.isArray(response.runtimes)
          ? response.runtimes
          : response.runtimeId
            ? [{
                runtimeId: response.runtimeId,
                runtimeName: response.runtimeName,
                connected: response.appConnected,
                sessionEpoch: response.sessionEpoch,
                runtime: response.runtime,
              }]
            : [];

        const status: Record<string, any> = {
          appConnected: response.appConnected,
          runtimeId: response.runtimeId,
          runtimeName: response.runtimeName,
          selectedRuntimeId,
          runtimes,
          sessionEpoch: response.sessionEpoch,
          mcpEnabled: response.mcpEnabled,
          runtime: response.runtime,
          tracing: response.tracing,
          handlers: response.handlers,
          stateAvailable: response.stateAvailable,
          stateRevisions: response.stateRevisions ?? null,
          traceCount: response.traceCount,
          capabilities: response.capabilities,
          readOnly: response.readOnly,
          protocol: response.protocol,
          security: response.security
        };
        if (typeof response.runtimeInstanceId === 'string') {
          status.runtimeInstanceId = response.runtimeInstanceId;
        }
        if (response.effectMode != null) status.effectMode = response.effectMode;
        if (response.effects != null) status.effects = response.effects;
        if (response.operations != null) status.operations = response.operations;
        if (response.connectedApps > 1) status.connectedApps = response.connectedApps;

        const hints: string[] = [];
        if (!response.mcpEnabled) {
          hints.push('The devtools server was started without --mcp: MCP inspection storage is disabled. Restart the project-local `devtools:mcp` script (for example, `npm run devtools:mcp`).');
        }
        if (!response.appConnected) {
          hints.push('No app is connected. Start one — a browser tab, or a headless state runtime (a src/headless.ts entry run under tsx/vite-node) for browserless work.');
        } else if (response.runtime == null && response.mcpEnabled) {
          hints.push('The connected app has not reported runtime info — its @ukladjs/devtools SDK likely predates runtime reporting.');
        } else if (response.tracing === false) {
          hints.push(response.operations?.available === true
            ? 'Tracing is off, so legacy dispatch_event outcomes will come back "unknown". dispatch_and_wait remains available through the DevTools operation snapshot capability.'
            : 'Tracing is off in the app, so dispatch_event outcomes will come back "unknown". Open the devtools UI or restart the server with --mcp to keep tracing on.');
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
        const routing = runtimeRoutingErrorResult(
          error,
          'app_status',
          params.runtimeId,
        );
        if (routing) return routing;

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
