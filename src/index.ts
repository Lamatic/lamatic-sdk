import { LamaticConfig, LamaticAPIResponse, LamaticResponse } from "./types";

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
   * Execute a workflow with the given flow ID and payload
   * @param {string} flowId - The ID of the workflow to execute
   * @param {Object} payload - The payload to pass to the workflow
   * @returns {Promise<LamaticResponse>} The response from the workflow
   */
  async executeFlow(flowId : string, payload : Record<string, unknown>): Promise<LamaticResponse> {
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
      const responseData : LamaticAPIResponse = JSON.parse(responseText);
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

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error("[Lamatic SDK Error] : ", errorMessage);
      throw new Error(errorMessage);
    }
  }

  /**
   * Execute a workflow with the given flow ID and payload
   * @param {string} agentId - The ID of the agent to execute
   * @param {Object} payload - The payload to pass to the workflow
   * @returns {Promise<LamaticResponse>} The response from the workflow
   */
  async executeAgent(agentId : string, payload : Record<string, unknown>): Promise<LamaticResponse> {
    try {

      const graphqlQuery = {
        query: `query ExecuteAgent(
                $agentId: String!
                $payload: JSON!
              )
              {
                executeAgent(
                  agentId: $agentId
                  payload: $payload
                )
                {
                  status
                  result
                }
              }`,
        variables: {
          agentId: agentId,
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
      const responseData : LamaticAPIResponse = JSON.parse(responseText);
      if (responseData.errors) {
        return {
          status: "error",
          result: null,
          message: responseData.errors[0].message,
          statusCode: response.status
        }
      }
      return {
        ...responseData.data.executeAgent,
        statusCode: response.status
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error("[Lamatic SDK Error] : ", errorMessage);
      throw new Error(errorMessage);
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
        const responseData: LamaticAPIResponse = JSON.parse(responseText);

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

        // If the status indicates completion (success or error), return immediately
        if (statusResult.status === "success" || statusResult.status === "error" || statusResult.status === "failed") {
          return statusResult;
        }

        // If still in progress, wait for the next poll interval
        if (Date.now() - startTime + intervalMs < timeoutMs) {
          await new Promise(resolve => setTimeout(resolve, intervalMs));
        }

      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        console.error("[Lamatic SDK Error] : ", errorMessage);
        return {
          status: "error",
          result: null,
          message: errorMessage,
          statusCode: 500
        };
      }
    }

    // Timeout reached
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
