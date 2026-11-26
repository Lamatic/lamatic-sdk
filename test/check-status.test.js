import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { Lamatic } from "../dist/index.js";

// Real API responses, shared with the Python and Go SDK test suites.
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/check-status.json", import.meta.url)));

// Each test queues the bodies the server answers with, one per request.
let replies = [];
let requests = [];
let server;
let lamatic;

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    requests.push(JSON.parse(body));
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(typeof reply === "string" ? reply : JSON.stringify(reply));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  lamatic = new Lamatic({
    endpoint: `http://127.0.0.1:${server.address().port}/graphql`,
    projectId: "project-1",
    apiKey: "key-1",
  });
});

after(() => server.close());

const reset = (...bodies) => {
  replies = bodies;
  requests = [];
};

test("checkStatus returns the flow's result once the run succeeds", async () => {
  reset(fixtures.inProgress, fixtures.success);

  const res = await lamatic.checkStatus("req-1", 0.01, 5);

  assert.equal(res.status, "success");
  assert.equal(res.result.answer, "hello async");
  assert.equal(res.statusCode, 200);
  assert.equal(requests.length, 2);
  assert.match(requests[0].query, /checkStatus\(\s*requestId: \$requestId\s*\)\s*}/);
});

test("checkStatus reports a failed run's error message", async () => {
  reset(fixtures.failed);

  const res = await lamatic.checkStatus("req-1", 0.01, 5);

  assert.equal(res.status, "failed");
  assert.match(res.message, /LLM node failed: 404/);
  assert.equal(res.result.failedNode.nodeId, "LLMNode_110");
});

test("checkStatus gives up on an unknown request after the grace period", async () => {
  reset(fixtures.notFound);
  lamatic.notFoundGraceMs = 30;

  const res = await lamatic.checkStatus("req-missing", 0.01, 5);

  lamatic.notFoundGraceMs = 60_000;
  assert.equal(res.status, "error");
  assert.equal(res.statusCode, 404);
  assert.match(res.message, /req-missing was not found/);
});

test("checkStatus keeps polling not-found during the grace period", async () => {
  reset(fixtures.notFound, fixtures.inProgress, fixtures.success);

  const res = await lamatic.checkStatus("req-1", 0.01, 5);

  assert.equal(res.status, "success");
  assert.equal(requests.length, 3);
});

test("checkStatus times out while the run is still going", async () => {
  reset(fixtures.inProgress);

  const res = await lamatic.checkStatus("req-slow", 0.01, 0.05);

  assert.equal(res.status, "error");
  assert.equal(res.statusCode, 408);
});

test("executeFlowPoll polls a queued run to its result", async () => {
  reset(fixtures.queued, fixtures.inProgress, fixtures.success);

  const res = await lamatic.executeFlowPoll("flow-1", { sampleInput: "hi" }, { interval: 0.01, timeout: 5 });

  assert.equal(res.status, "success");
  assert.equal(res.result.answer, "hello async");
  assert.match(requests[0].query, /executeWorkflow/);
  assert.equal(requests[1].variables.requestId, fixtures.queued.data.executeWorkflow.result.requestId);
});

test("executeFlowPoll returns a realtime flow's response without polling", async () => {
  reset({ data: { executeWorkflow: { status: "success", result: { answer: "now", requestId: "req-2" } } } });

  const res = await lamatic.executeFlowPoll("flow-1", {}, { interval: 0.01, timeout: 5 });

  assert.equal(res.result.answer, "now");
  assert.equal(requests.length, 1);
});

test("checkStatus keeps polling through a dropped connection", async () => {
  // One reply that is not JSON, as a gateway error page would be, then the real answer.
  reset("not json", fixtures.success);
  const res = await lamatic.checkStatus("req-1", 0.01, 5);
  assert.equal(res.status, "success");
  assert.equal(requests.length, 2);
});

test("checkStatus reports the last error when the timeout runs out", async () => {
  reset("not json");
  const res = await lamatic.checkStatus("req-1", 0.01, 0.05);
  assert.equal(res.statusCode, 408);
  assert.match(res.message, /Last error: /);
});
