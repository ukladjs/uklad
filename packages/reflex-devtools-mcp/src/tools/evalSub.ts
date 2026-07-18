/**
 * MCP Tool: eval_sub
 * Evaluate a registered subscription without requiring a mounted component
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

export interface EvalSubParams extends RuntimeSelectionParams {
  id: string;
  args?: any[];
}

export function evalSubTool(apiClient: DevToolsAPIClient) {
  return {
    name: 'eval_sub',
    description: 'Evaluate any registered Reflex subscription against the live app state, even when no component has mounted it. Use this to verify a new subscription\'s output before writing a view. Pass only the arguments after the subscription id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          maxLength: 256,
          description: 'The registered subscription id (for example, "user-by-id")'
        },
        args: {
          type: 'array',
          maxItems: 100,
          description: 'Optional subscription arguments, excluding the id',
          items: {
            type: ['string', 'number', 'boolean', 'object', 'array', 'null']
          }
        },
        runtimeId: runtimeIdInputProperty,
      },
      required: ['id'],
      additionalProperties: false
    },
    handler: async (params: EvalSubParams) => {
      const args = params.args || [];
      try {
        const response = await apiClient.evalSub(
          params.id,
          args,
          params.runtimeId,
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...runtimeMetadata(response),
                id: params.id,
                value: response.value
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        const unavailable = serverUnavailableResult(error, 'eval_sub');
        if (unavailable) return unavailable;
        const routing = runtimeRoutingErrorResult(
          error,
          'eval_sub',
          params.runtimeId,
        );
        if (routing) return routing;

        const details = (error as any)?.details;
        const evaluationError = details?.error ?? details;
        const missingHandler =
          evaluationError?.phase === 'missing-handler';
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Failed to evaluate subscription',
                message: error instanceof Error ? error.message : 'Unknown error',
                id: params.id,
                ...(evaluationError && typeof evaluationError === 'object'
                  ? { details: evaluationError }
                  : {}),
                hint: missingHandler
                  ? 'No handler is registered for this subscription id — check get_handlers with type "sub" for the exact spelling'
                  : 'Make sure the DevTools server and app are running'
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  };
}
