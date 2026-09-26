import {
  LamaticConfig,
  LamaticAPIResponse,
  LamaticResponse,
  LamaticStreamChunk,
  LamaticRawStreamChunk,
  LamaticStreamOptions,
  LamaticTokenEvent,
  PollOptions,
} from "./types";

/** The `executeWorkflowWithStream` field returns a `JSON!` scalar, so it takes no selection set. */
const STREAM_SUBSCRIPTION = `subscription ExecuteWorkflowWithStream(
              $workflowId: String
              $payload: JSON!
              $source: String
              $command: String
            ) {
              executeWorkflowWithStream(
                workflowId: $workflowId
                payload: $payload
                source: $source
                command: $command
              )
            }`;

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
   * Execute a workflow and stream its LLM/RAG output one token at a time.
   *
   * Opens the `executeWorkflowWithStream` GraphQL subscription over Server-Sent
   * Events and yields a typed event per frame:
   *
   *  - `token` — one text delta from a streaming node (LLM or RAG)
   *  - `node`  — a node finished; `output` holds its full output
   *  - `final` — the flow finished; `result` is its output and `text` is every
   *              token concatenated
   *  - `error` — execution failed; the stream ends if the failure was fatal
   *
   * Only LLM and RAG nodes stream token by token. Every other node reports once,
   * as a single `node` event when it completes.
   *
   * Prefer the accumulated `text` on the `final` event over reading
   * `generatedResponse` off a node's output: the platform currently returns that
   * field with its content duplicated, and a flow's final result often carries
   * only what its response node was configured to return.
   *
   * @param {string} flowId - The ID of the workflow to execute
   * @param {Object} payload - The payload to pass to the workflow
   * @param {LamaticStreamOptions} [options] - Abort signal and trigger source overrides
   * @yields {LamaticTokenEvent} One event per stream frame
   *
   * @example
   * for await (const event of lamatic.executeFlowTokenStream(flowId, { sampleInput: "Hello" })) {
   *   if (event.type === "token") process.stdout.write(event.token);
   *   if (event.type === "final") console.log("\n", event.text);
   *   if (event.type === "error") console.error(event.message);
   * }
   */
  async *executeFlowTokenStream(
    flowId: string,
    payload: Object,
    options: LamaticStreamOptions = {}
  ): AsyncGenerator<LamaticTokenEvent> {
    let text = "";
    const textByNode: Record<string, string> = {};

    try {
      for await (const chunk of this.streamSubscription(flowId, payload, options)) {
        const nodeId = chunk.nodeId;

        if (chunk.status === "error") {
          const body = chunk.data ?? chunk.result ?? {};
          yield {
            type: "error",
            message: body.errorMsg ?? "Workflow execution failed",
            nodeId,
            raw: chunk,
          };
          if (chunk.isFlowExecutionFinished) return;
          continue;
        }

        // A token frame: `status: "streaming"` with a single delta in `data`.
        if (chunk.status === "streaming" && !chunk.isNodeExecutionFinished) {
          const token = chunk.data?.generatedResponse;
          if (typeof token === "string" && token !== "") {
            text += token;
            if (nodeId) {
              textByNode[nodeId] = (textByNode[nodeId] ?? "") + token;
            }
            yield { type: "token", token, nodeId, raw: chunk };
          }
          continue;
        }

        // Checked before `isNodeExecutionFinished`: the terminal frame can set both.
        if (chunk.isFlowExecutionFinished) {
          yield {
            type: "final",
            result: chunk.data ?? chunk.result ?? null,
            text,
            textByNode,
            raw: chunk,
          };
          return;
        }

        if (chunk.isNodeExecutionFinished) {
          yield { type: "node", nodeId, output: chunk.data ?? null, raw: chunk };
        }
      }
    } catch (error: Error | any) {
      // A caller-initiated abort ends the stream quietly rather than as a failure.
      if (error?.name === "AbortError") return;
      console.error("[Lamatic SDK Error] : ", error.message);
      yield { type: "error", message: error.message };
    }
  }

  /**
   * Execute a workflow and stream the response via Server-Sent Events.
   *
   * Thin wrapper over {@link executeFlowTokenStream} kept for backwards
   * compatibility. New code should use `executeFlowTokenStream`, which reports
   * per-node output and the accumulated text.
   *
   * @param {string} flowId - The ID of the workflow to execute
   * @param {Object} payload - The payload to pass to the workflow
   * @param {LamaticStreamOptions} [options] - Abort signal and trigger source overrides
   * @yields {LamaticStreamChunk} Chunks of the streaming response
   */
  async *executeFlowStream(
    flowId: string,
    payload: Object,
    options: LamaticStreamOptions = {}
  ): AsyncGenerator<LamaticStreamChunk> {
    for await (const event of this.executeFlowTokenStream(flowId, payload, options)) {
      switch (event.type) {
        case "token":
          yield { event: "data", data: event.token, done: false };
          break;
        case "error":
          yield { event: "error", message: event.message, done: false };
          break;
        case "final":
          yield { event: "result", data: event.result, done: false };
          yield { event: "done", done: true };
          return;
      }
    }
  }

  /**
   * Open the streaming subscription and yield each frame, unwrapped from its
   * GraphQL envelope. Ends after the frame with `isFlowExecutionFinished: true`.
   * @param {string} flowId - The ID of the workflow to execute
   * @param {Object} payload - The payload to pass to the workflow
   * @param {LamaticStreamOptions} options - Abort signal and trigger source overrides
   * @yields {LamaticRawStreamChunk} One chunk per SSE frame
   */
  private async *streamSubscription(
    flowId: string,
    payload: Object,
    options: LamaticStreamOptions
  ): AsyncGenerator<LamaticRawStreamChunk> {
    const graphqlQuery = {
      query: STREAM_SUBSCRIPTION,
      variables: {
        workflowId: flowId,
        payload: payload,
        source: options.source,
        command: options.command,
      },
    };

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(graphqlQuery),
      signal: options.signal,
    });

    const contentType = response.headers.get("content-type") ?? "";

    // Auth failures, rate limits and query-validation errors come back as plain JSON.
    if (!contentType.includes("text/event-stream")) {
      yield this.chunkFromJsonResponse(await response.text(), response.status);
      return;
    }

    if (!response.body) {
      yield {
        status: "error",
        data: { errorMsg: "Response body is empty" },
        isFlowExecutionFinished: true,
      };
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
        // SSE separates events with a blank line.
        const frames = buffer.replace(/\r\n/g, "\n").split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const envelope = this.parseFrame(frame);
          if (envelope === undefined) continue;

          if (envelope.errors?.length) {
            yield {
              status: "error",
              data: { errorMsg: envelope.errors[0].message },
              isFlowExecutionFinished: true,
            };
            return;
          }

          const chunk = envelope.data?.executeWorkflowWithStream;
          // The server also emits frames with a null payload; nothing to report.
          if (chunk === undefined || chunk === null) continue;

          yield chunk;
          if (chunk.isFlowExecutionFinished) return;
        }
      }
    } finally {
      // Releases the connection when the caller breaks out of the loop early.
      await reader.cancel().catch(() => undefined);
    }
  }

  /**
   * Parse one SSE frame into its JSON payload, joining multi-line `data:` fields.
   * @param {string} frame - A single SSE frame
   * @returns {any | undefined} The parsed payload, or undefined when the frame carries no data
   */
  private parseFrame(frame: string): any | undefined {
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      // `:` prefixes a comment, used for keep-alives.
      if (line.startsWith(":")) continue;
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (dataLines.length === 0) return undefined;

    const raw = dataLines.join("\n");
    if (raw === "[DONE]") {
      return { data: { executeWorkflowWithStream: { isFlowExecutionFinished: true } } };
    }
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  /**
   * Build a terminal chunk from a non-streaming response body.
   * @param {string} body - The raw response body
   * @param {number} statusCode - The HTTP status code
   * @returns {LamaticRawStreamChunk} A chunk marked as the end of the flow
   */
  private chunkFromJsonResponse(body: string, statusCode: number): LamaticRawStreamChunk {
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      return {
        status: "error",
        data: { errorMsg: `Unexpected non-streaming response (HTTP ${statusCode})` },
        isFlowExecutionFinished: true,
      };
    }

    if (parsed?.errors?.length) {
      return {
        status: "error",
        data: { errorMsg: parsed.errors[0].message },
        isFlowExecutionFinished: true,
      };
    }

    const result = parsed?.data?.executeWorkflowWithStream ?? parsed?.data?.executeWorkflow;
    return {
      status: result?.status ?? "success",
      data: result?.result ?? result ?? null,
      isFlowExecutionFinished: true,
    };
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
