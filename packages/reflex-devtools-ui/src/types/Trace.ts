export type TraceID = number;

export interface TraceTags extends Record<string, any> {
    /** Cache key for the subscription instance that ran or triggered a render. */
    subscriptionKey?: string;
    /** Cache keys for subscriptions read by a computed subscription. */
    deps?: string[];
}

export interface TraceOpts {
    operation?: string;
    opType?: string;
    tags?: TraceTags;
    childOf?: TraceID;
}

export interface Trace extends TraceOpts {
    id: TraceID;
    start: number;
    end?: number;
    duration?: number;
}

export type Badge = {
    label: string;
    number: number;
}

export type TraceItem = {
    id: number;
    type: string;
    traces: Trace[];
    badges: Badge[];
}
