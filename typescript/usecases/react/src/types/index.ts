export interface KeyValuePair {
    id: string;
    key: string;
    value: string;
}

export interface Credentials {
    authType: 'accessToken' | 'apiKey';
    accessToken: string;
    apiKey: string;
    projectId: string;
    endpoint: string;
    flowId: string;
    agentId: string;
}