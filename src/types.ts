export interface LamaticConfig {
    endpoint: string;
    projectId: string | null;
    apiKey?: string | null;
    accessToken?: string | null;
}

interface Error {
    message: string;
}

export type LamaticStatus = "success" | "error";

export interface LamaticAPIResponse {
    data: {
        executeAgent: LamaticResponse | PromiseLike<LamaticResponse>;
        executeWorkflow: LamaticResponse;
        checkStatus: LamaticResponse;
    }
    errors?: Error[];
}

export interface LamaticResponse {
    status: LamaticStatus;
    result: Record<string, unknown> | null;
    message?: string;
    statusCode?: number;
}
