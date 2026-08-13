import { LamaticConfig, LamaticAPIResponse, LamaticResponse, LamaticStreamChunk, PollOptions } from "./types";

class Lamatic {
  name: string = "Lamatic SDK";
  endpoint: string = "";
  projectId: string = "";
  apiKey?: string | null | undefined;
  accessToken?: string | null | undefined;
  /**
   * Constructor to initialize the Lamatic SDK with configuration options
   * @param {Object} config - Configuration object
   * @param {string} [config.endpoint] - The endpoint URL for the Lamatic API
   * @param {string} [config.apiKey] - The API key for the Lamatic API
   * @param {string} [config.projectId] - The project ID for the Lamatic API
   * @param {string} [config.accessToken] - The access token for the Lamatic API
   */

  constructor(config : LamaticConfig) {
    if (!config) {
      throw new Error('Configuration object is required');
    }

    if(!config.endpoint) {
      throw new Error('Endpoint URL is required');
    }

    if(!config.projectId) {
      throw new Error('Project ID is required');
    }

    if(!(config.apiKey) && !config.accessToken) {
      throw new Error('API key or Access Token is required');
    }
    this.endpoint = config.endpoint;
    this.projectId = config.projectId;
    this.apiKey = config.apiKey;
    this.accessToken = config.accessToken;
  }


  /**
   * Execute a workflow and stream the response via Server-Sent Events.
   * @param {string} flowId - The ID of the workflow to execute
   * @param {Object} payload - The payload to pass to the workflow
   * @yields {LamaticStreamChunk} Chunks of the streaming response
   */
  async *executeFlowStream(
    flowId: string,
    payload: Object
  ): AsyncGenerator<LamaticStreamChunk> {
    const graphqlQuery = {
      query: `query ExecuteWorkflow(
              $workflowId: String!
              $payload: JSON!
            ) {
              executeWorkflow(
                workflowId: $workflowId
                payload: $payload
              ) {
                status
                result
              }
            }`,
      variables: {
        workflowId: flowId,
        payload,
      },
    };

    const headers = {
      ...this.getHeaders(),
      "Accept": "text/event-stream",
    };

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(graphqlQuery),
      });

      const contentType = response.headers.get("content-type") ?? "";

      if (!contentType.includes("text/event-stream")) {
        // Server returned a regular JSON response — yield it as a single chunk
        const text = await response.text();
        const responseData: LamaticAPIResponse = JSON.parse(text);
        if (responseData.errors) {
          yield { event: "error", message: responseData.errors[0].message, done: false };
          return;
        }
        yield { event: "data", data: responseData.data.executeWorkflow.result, done: false };
        yield { event: "done", done: true };
        return;
      }

      if (!response.body) {
        yield { event: "error", message: "Response body is empty", done: false };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "" || trimmed.startsWith(":")) continue;

            if (trimmed.startsWith("data:")) {
              const raw = trimmed.slice(5).trimStart();
              if (raw === "[DONE]") {
                yield { event: "done", done: true };
                return;
              }
              try {
                const parsed = JSON.parse(raw);
                yield { ...parsed, done: false };
              } catch {
                yield { event: "data", data: raw, done: false };
              }
            }
          }
        }
        yield { event: "done", done: true };
      } finally {
        reader.releaseLock();
      }
    } catch (error: Error | any) {
      console.error("[Lamatic SDK Error] : ", error.message);
      yield { event: "error", message: error.message, done: false };
    }
  }

  /**
   * Execute a workflow and automatically poll for completion if an async
   * @param {string} flowId - The ID of the workflow to execute
   * @param {Object} payload - The payload to pass to the workflow
   * @param {PollOptions} [pollOptions] - Optional polling configuration
   * @returns {Promise<LamaticResponse>} The final response after polling
   */
  async executeFlowPoll(
    flowId: string,
    payload: Object,
    pollOptions: PollOptions = {}
  ): Promise<LamaticResponse> {
    const response = await this.executeFlow(flowId, payload);

    if (response.requestId) {
      return this.checkStatus(
        response.requestId,
        pollOptions.interval ?? 15,
        pollOptions.timeout ?? 900
      );
    }

    return response;
  }

  /**
   * Execute a workflow with the given flow ID and payload
   * @param {string} flowId - The ID of the workflow to execute
   * @param {Object} payload - The payload to pass to the workflow
   * @returns {Promise<LamaticResponse>} The response from the workflow
   */
  async executeFlow(flowId : string, payload : Object): Promise<LamaticResponse> {
    try {

      const graphqlQuery = {
        query: `query ExecuteWorkflow(
                $workflowId: String!
                $payload: JSON!
              )
              {
                executeWorkflow(
                  workflowId: $workflowId
                  payload: $payload
                )
                {
                  status
                  result
                }
              }`,
        variables: {
          workflowId: flowId,
          payload : payload,
        },
      };

      const headers = this.getHeaders();
      const options = {
        method: "POST",
        headers: headers,
        body: JSON.stringify(graphqlQuery),
      };

      const response = await fetch(this.endpoint, options);
      const responseText = await response.text();
      let responseData : LamaticAPIResponse = JSON.parse(responseText);
      if (responseData.errors) {
        return {
          status: "error",
          result: null,
          message: responseData.errors[0].message,
          statusCode: response.status
        }
      }

      return {
        ...responseData.data.executeWorkflow,
        statusCode: response.status
      };

    } catch (error : Error | any) {
      console.error("[Lamatic SDK Error] : ", error.message);
      throw new Error(error.message);
    }
  }

  /**
   * Check the status of a request with polling capability
   * @param {string} requestId - The request ID to check status for
   * @param {number} [pollInterval=15] - Polling interval in seconds (default: 15)
   * @param {number} [pollTimeout=900] - Polling timeout in seconds (default: 900)
   * @returns {Promise<LamaticResponse>} The response from the status check
   */
  async checkStatus(
    requestId: string,
    pollInterval: number = 15,
    pollTimeout: number = 900
  ): Promise<LamaticResponse> {
    const startTime = Date.now();
    const timeoutMs = pollTimeout * 1000;
    const intervalMs = pollInterval * 1000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const graphqlQuery = {
          query: `query CheckStatus(
                  $requestId: String!
                ) {
                  checkStatus(
                    requestId: $requestId
                  )
                }`,
          variables: {
            requestId: requestId,
          },
        };

        const headers = this.getHeaders();
        const options = {
          method: "POST",
          headers: headers,
          body: JSON.stringify(graphqlQuery),
        };

        const response = await fetch(this.endpoint, options);
        const responseText = await response.text();
        let responseData: LamaticAPIResponse = JSON.parse(responseText);

        if (responseData.errors) {
          return {
            status: "error",
            result: null,
            message: responseData.errors[0].message,
            statusCode: response.status
          };
        }

        const statusResult = {
          ...responseData.data.checkStatus,
          statusCode: response.status
        };

        if (statusResult.status === "success" || statusResult.status === "error" || statusResult.status === "failed") {
          return statusResult;
        }

        if (Date.now() - startTime + intervalMs < timeoutMs) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        }

      } catch (error: Error | any) {
        console.error("[Lamatic SDK Error] : ", error.message);
        return {
          status: "error",
          result: null,
          message: error.message,
          statusCode: 500
        };
      }
    }

    return {
      status: "error",
      result: null,
      message: `Request checkStatus timedout after ${pollTimeout} seconds, your request may still be executing in the background and you can check after few minutes`,
      statusCode: 408
    };
  }


  /**
   * Get the headers for the API request
   * @returns {Record<string, string>} The headers for the API request
   */
  getHeaders(): Record<string, string> {
    if(this.accessToken){
      return {
        "Content-Type" : "application/json",
        "X-Lamatic-Signature" : this.accessToken,
        "x-project-id": this.projectId
      }
    }
    return {
      "Content-Type" : "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      "x-project-id": this.projectId
    };
  }

  /**
   * Update the access token for the Lamatic SDK
   * @param {string} accessToken - The new access token
   */
  updateAccessToken(accessToken : string) {
    this.accessToken = accessToken;
  }
}

export { Lamatic };
