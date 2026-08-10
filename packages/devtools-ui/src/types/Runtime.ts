export interface DevtoolsRuntimeSummary {
    runtimeId: string;
    runtimeName: string;
    connected: boolean;
    sessionEpoch: number;
    runtime: 'browser' | 'headless' | 'react-native' | null;
}

/** Monotonic commit and publication heads for the selected runtime state. */
export interface StateRevisions {
    committedRevision: number;
    publishedRevision: number;
}
