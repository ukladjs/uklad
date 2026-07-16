/**
 * HTTP client for querying DevTools server REST API
 */

export interface DevToolsAPIConfig {
  serverUrl: string;
}

export class DevToolsServerUnavailableError extends Error {
  constructor(public readonly serverUrl: string) {
    super('No Reflex DevTools server is connected.');
    this.name = 'DevToolsServerUnavailableError';
  }
}

export function isDevToolsServerUnavailableError(error: unknown): error is DevToolsServerUnavailableError {
  return error instanceof DevToolsServerUnavailableError;
}

export function devToolsServerUnavailableBody(retryTool: string) {
  const command = 'npm run devtools:mcp';
  return {
    error: 'No Reflex DevTools server is connected.',
    message: [
      'No Reflex DevTools server is connected.',
      'Start the project-local DevTools script from the project root (or use the detected package manager equivalent):',
      `  ${command}`,
      'If the script is missing, add "devtools:mcp": "reflex-devtools --mcp --host 127.0.0.1 --port 4000" to package.json.',
      `Then reload the app and retry ${retryTool}.`
    ].join('\n'),
    command,
    retry: retryTool
  };
}

export class DevToolsAPIClient {
  private baseUrl: string;
  private serverUrl: string;

  constructor(config: DevToolsAPIConfig) {
    this.serverUrl = config.serverUrl;
    this.baseUrl = `http://${config.serverUrl}`;
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch (error) {
      throw new DevToolsServerUnavailableError(this.serverUrl);
    }
  }

  async getTraces(params: {
    limit?: number;
    eventFilter?: string;
    minDuration?: number;
    opType?: string;
  } = {}): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.eventFilter) queryParams.append('eventFilter', params.eventFilter);
    if (params.minDuration) queryParams.append('minDuration', params.minDuration.toString());
    if (params.opType) queryParams.append('opType', params.opType);

    const response = await this.fetch(`/api/traces?${queryParams}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async getTrace(id: number): Promise<any> {
    const response = await this.fetch(`/api/traces/${id}`);
    if (!response.ok) {
      const body: any = await response.json().catch(() => null);
      throw new Error(body?.error || `HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async getAppState(): Promise<any> {
    const response = await this.fetch('/api/state');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async getSubscriptions(): Promise<any> {
    const response = await this.fetch('/api/subscriptions');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async getHandlers(type?: string): Promise<any> {
    const queryParams = type ? `?type=${type}` : '';
    const response = await this.fetch(`/api/handlers${queryParams}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async getStats(): Promise<any> {
    const response = await this.fetch('/api/stats');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async dispatchEvent(eventName: string, params: any[] = []): Promise<any> {
    const response = await this.fetch('/api/dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ eventName, params }),
    });
    if (!response.ok) {
      // The server puts the reason (e.g. no app connected) in the body
      const body: any = await response.json().catch(() => null);
      throw new Error(body?.error || `HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async evalSub(id: string, args: any[] = []): Promise<any> {
    const response = await this.fetch('/api/eval-sub', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id, args }),
    });
    const body: any = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body?.error;
      const error = new Error(
        typeof detail === 'string'
          ? detail
          : detail?.message || `HTTP ${response.status}: ${response.statusText}`
      );
      (error as any).details = detail;
      throw error;
    }
    return body;
  }

  async getStatus(): Promise<any> {
    const response = await this.fetch('/api/status');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.fetch('/health');
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}
