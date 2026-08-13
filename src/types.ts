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
