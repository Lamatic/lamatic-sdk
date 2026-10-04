import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Lamatic } from "../dist/index.js";

describe("Lamatic SDK Unit Test Suite", () => {
  const validConfig = {
    endpoint: "https://api.lamatic.ai/graphql",
    projectId: "test-project-123",
    apiKey: "test-api-key-abc",
  };

  describe("Constructor & Invariants Validation", () => {
    it("should throw an error when config object is missing", () => {
      assert.throws(() => new Lamatic(), {
        name: "Error",
        message: "Configuration object is required",
      });
    });

    it("should throw an error when endpoint is missing", () => {
      assert.throws(
        () => new Lamatic({ projectId: "p1", apiKey: "k1" }),
        {
          name: "Error",
          message: "Endpoint URL is required",
        }
      );
    });

    it("should throw an error when projectId is missing", () => {
      assert.throws(
        () => new Lamatic({ endpoint: "https://api.lamatic.ai", apiKey: "k1" }),
        {
          name: "Error",
          message: "Project ID is required",
        }
      );
    });

    it("should throw an error when neither apiKey nor accessToken is provided", () => {
      assert.throws(
        () =>
          new Lamatic({
            endpoint: "https://api.lamatic.ai",
            projectId: "p1",
          }),
        {
          name: "Error",
          message: "API key or Access Token is required",
        }
      );
    });

    it("should initialize successfully with an API key", () => {
      const client = new Lamatic(validConfig);
      assert.equal(client.endpoint, validConfig.endpoint);
      assert.equal(client.projectId, validConfig.projectId);
      assert.equal(client.apiKey, validConfig.apiKey);
      assert.equal(client.name, "Lamatic SDK");
    });

    it("should initialize successfully with an Access Token", () => {
      const client = new Lamatic({
        endpoint: "https://api.lamatic.ai/graphql",
        projectId: "test-project-123",
        accessToken: "jwt-token-sample-456",
      });
      assert.equal(client.accessToken, "jwt-token-sample-456");
      assert.equal(client.apiKey, undefined);
    });
  });

  describe("Authentication & Header Management", () => {
    it("should generate Bearer authorization header when apiKey is used", () => {
      const client = new Lamatic(validConfig);
      const headers = client.getHeaders();

      assert.deepEqual(headers, {
        "Content-Type": "application/json",
        Authorization: "Bearer test-api-key-abc",
        "x-project-id": "test-project-123",
      });
    });

    it("should generate X-Lamatic-Signature header when accessToken is used", () => {
      const client = new Lamatic({
        endpoint: "https://api.lamatic.ai/graphql",
        projectId: "test-project-123",
        accessToken: "jwt-token-sample-456",
      });
      const headers = client.getHeaders();

      assert.deepEqual(headers, {
        "Content-Type": "application/json",
        "X-Lamatic-Signature": "jwt-token-sample-456",
        "x-project-id": "test-project-123",
      });
    });

    it("should dynamically update accessToken via updateAccessToken()", () => {
      const client = new Lamatic({
        endpoint: "https://api.lamatic.ai/graphql",
        projectId: "test-project-123",
        accessToken: "initial-token",
      });

      assert.equal(client.accessToken, "initial-token");
      client.updateAccessToken("refreshed-new-token");

      assert.equal(client.accessToken, "refreshed-new-token");
      const headers = client.getHeaders();
      assert.equal(headers["X-Lamatic-Signature"], "refreshed-new-token");
    });
  });

  describe("executeFlow (Hermetic Network Mocking)", () => {
    it("should execute workflow successfully and parse GraphQL response", async (t) => {
      const client = new Lamatic(validConfig);
      const mockResult = { answer: "Hello from Lamatic" };

      t.mock.method(globalThis, "fetch", async (url, options) => {
        assert.equal(url, validConfig.endpoint);
        assert.equal(options.method, "POST");

        const parsedBody = JSON.parse(options.body);
        assert.equal(parsedBody.variables.workflowId, "flow-test-1");
        assert.deepEqual(parsedBody.variables.payload, { prompt: "test" });

        return new Response(
          JSON.stringify({
            data: {
              executeWorkflow: {
                status: "success",
                result: mockResult,
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const response = await client.executeFlow("flow-test-1", { prompt: "test" });
      assert.equal(response.status, "success");
      assert.deepEqual(response.result, mockResult);
      assert.equal(response.statusCode, 200);
    });

    it("should format error response when backend returns GraphQL errors", async (t) => {
      const client = new Lamatic(validConfig);

      t.mock.method(globalThis, "fetch", async () => {
        return new Response(
          JSON.stringify({
            errors: [{ message: "Workflow ID 'invalid-flow' not found" }],
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      });

      const response = await client.executeFlow("invalid-flow", {});
      assert.equal(response.status, "error");
      assert.equal(response.result, null);
      assert.equal(response.message, "Workflow ID 'invalid-flow' not found");
      assert.equal(response.statusCode, 404);
    });

    it("should throw Error when network call rejects", async (t) => {
      const client = new Lamatic(validConfig);

      t.mock.method(globalThis, "fetch", async () => {
        throw new Error("DNS resolution failed");
      });

      await assert.rejects(
        () => client.executeFlow("flow-1", {}),
        {
          name: "Error",
          message: "DNS resolution failed",
        }
      );
    });
  });

  describe("executeFlowPoll & checkStatus", () => {
    it("should return immediately if status is 'success'", async (t) => {
      const client = new Lamatic(validConfig);

      t.mock.method(globalThis, "fetch", async () => {
        return new Response(
          JSON.stringify({
            data: {
              checkStatus: {
                status: "success",
                result: { completed: true },
              },
            },
          }),
          { status: 200 }
        );
      });

      const result = await client.checkStatus("req-123", 1, 5);
      assert.equal(result.status, "success");
      assert.deepEqual(result.result, { completed: true });
    });
  });

  describe("executeFlowTokenStream (SSE Streaming Mock)", () => {
    it("should stream tokens and accumulate final text correctly", async (t) => {
      const client = new Lamatic(validConfig);

      t.mock.method(globalThis, "fetch", async () => {
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            // 1. Comment / keepalive line (should be ignored)
            controller.enqueue(encoder.encode(":keepalive\n\n"));

            // 2. Token 1
            controller.enqueue(
              encoder.encode(
                "data: " +
                  JSON.stringify({
                    data: {
                      executeWorkflowWithStream: {
                        status: "streaming",
                        nodeId: "llm-1",
                        data: { generatedResponse: "Hello " },
                      },
                    },
                  }) +
                  "\n\n"
              )
            );

            // 3. Token 2
            controller.enqueue(
              encoder.encode(
                "data: " +
                  JSON.stringify({
                    data: {
                      executeWorkflowWithStream: {
                        status: "streaming",
                        nodeId: "llm-1",
                        data: { generatedResponse: "World!" },
                      },
                    },
                  }) +
                  "\n\n"
              )
            );

            // 4. Terminal frame
            controller.enqueue(
              encoder.encode(
                "data: " +
                  JSON.stringify({
                    data: {
                      executeWorkflowWithStream: {
                        isFlowExecutionFinished: true,
                        data: { fullResult: "done" },
                      },
                    },
                  }) +
                  "\n\n"
              )
            );

            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      const events = [];
      for await (const event of client.executeFlowTokenStream("flow-stream-1", {})) {
        events.push(event);
      }

      assert.equal(events.length, 3);
      assert.equal(events[0].type, "token");
      assert.equal(events[0].token, "Hello ");
      assert.equal(events[1].type, "token");
      assert.equal(events[1].token, "World!");
      assert.equal(events[2].type, "final");
      assert.equal(events[2].text, "Hello World!");
      assert.deepEqual(events[2].result, { fullResult: "done" });
    });

    it("should handle non-streaming JSON fallback on auth/query error", async (t) => {
      const client = new Lamatic(validConfig);

      t.mock.method(globalThis, "fetch", async () => {
        return new Response(
          JSON.stringify({
            errors: [{ message: "Unauthorized token" }],
          }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      });

      const events = [];
      for await (const event of client.executeFlowTokenStream("flow-stream-1", {})) {
        events.push(event);
      }

      assert.equal(events.length, 1);
      assert.equal(events[0].type, "error");
      assert.equal(events[0].message, "Unauthorized token");
    });

    it("should exit quietly without yielding error when AbortSignal is aborted", async (t) => {
      const client = new Lamatic(validConfig);
      const controller = new AbortController();

      t.mock.method(globalThis, "fetch", async () => {
        const abortErr = new Error("The operation was aborted");
        abortErr.name = "AbortError";
        throw abortErr;
      });

      const events = [];
      for await (const event of client.executeFlowTokenStream(
        "flow-stream-1",
        {},
        { signal: controller.signal }
      )) {
        events.push(event);
      }

      assert.equal(events.length, 0);
    });
  });
});
