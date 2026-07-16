import {
  devToolsServerUnavailableBody,
  isDevToolsServerUnavailableError
} from '../httpClient.js';

export function serverUnavailableResult(error: unknown, retryTool: string) {
  if (!isDevToolsServerUnavailableError(error)) return null;

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(devToolsServerUnavailableBody(retryTool), null, 2)
      }
    ],
    isError: true
  };
}
