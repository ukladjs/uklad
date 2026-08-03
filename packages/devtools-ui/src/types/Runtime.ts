export interface DevtoolsRuntimeSummary {
    runtimeId: string;
    runtimeName: string;
    connected: boolean;
    sessionEpoch: number;
    runtime: 'browser' | 'headless' | 'react-native' | null;
}
