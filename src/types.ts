export interface LamaticConfig {
    endpoint: string | undefined;
    projectId: string | null | undefined;
    apiKey?: string | null;
    accessToken?: string | null;
}

interface Error {
    message: string;
}

export type LamaticStatus = "success" | "error" | "pending" | "processing" | "failed";

export interface LamaticAPIResponse {
    data: {
        executeWorkflow: LamaticResponse;
        checkStatus: LamaticResponse;
    }
    errors?: Error[];
}

export interface LamaticResponse {
    status: LamaticStatus;
    result: Record<string, any> | null;
    message?: string;
    statusCode?: number;
    requestId?: string;
}

export interface LamaticStreamChunk {
    event?: string;
    data?: string | Record<string, any> | null;
    message?: string;
    done: boolean;
}

export interface PollOptions {
    interval?: number;  // polling interval in seconds (default: 15)
    timeout?: number;   // max wait time in seconds (default: 900)
}

/**
 * A single frame emitted by the `executeWorkflowWithStream` subscription,
 * unwrapped from its GraphQL envelope.
 *
 * Frames arrive in this order for a flow containing a streaming node:
 *   1. one per upstream node, with `isNodeExecutionFinished: true`
 *   2. many with `status: "streaming"` — one LLM/RAG token each
 *   3. one with `isNodeExecutionFinished: true` for the streaming node,
 *      carrying `_meta` (token counts and cost)
 *   4. one with `isFlowExecutionFinished: true` — the flow's final output
 */
export interface LamaticRawStreamChunk {
    status?: "streaming" | LamaticStatus | string;
    /** Node output, or `{ generatedResponse }` on a token frame. */
    data?: Record<string, any> | null;
    /** Some server error paths use `result` instead of `data`. */
    result?: Record<string, any> | null;
    /** Absent on the terminal flow frame. */
    nodeId?: string;
    isNodeExecutionFinished?: boolean;
    isFlowExecutionFinished?: boolean;
}

export interface LamaticStreamOptions {
    /** Aborts the request; the generator then returns without yielding further events. */
    signal?: AbortSignal;
    /** Trigger source used to resolve the flow. Defaults to `graphql` server-side. */
    source?: string;
    command?: string;
}

/** A single token (text delta) produced by an LLM or RAG node. */
export interface LamaticTokenEventToken {
    type: "token";
    token: string;
    nodeId?: string;
    raw: LamaticRawStreamChunk;
}

/** A node finished executing; `output` is its full output. */
export interface LamaticTokenEventNode {
    type: "node";
    nodeId?: string;
    output: Record<string, any> | null;
    raw: LamaticRawStreamChunk;
}

/** The flow finished. Always the last event of a successful stream. */
export interface LamaticTokenEventFinal {
    type: "final";
    /** The flow's final output, as configured by its response node. */
    result: Record<string, any> | null;
    /** Every token concatenated in arrival order. */
    text: string;
    /** Tokens concatenated per node, for flows with more than one streaming node. */
    textByNode: Record<string, string>;
    raw: LamaticRawStreamChunk;
}

export interface LamaticTokenEventError {
    type: "error";
    message: string;
    nodeId?: string;
    raw?: LamaticRawStreamChunk;
}

export type LamaticTokenEvent =
    | LamaticTokenEventToken
    | LamaticTokenEventNode
    | LamaticTokenEventFinal
    | LamaticTokenEventError;
