import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Lamatic } from "../dist/index.js";

const frame = (chunk) => `data: ${JSON.stringify({ data: { executeWorkflowWithStream: chunk } })}\n\n`;
const token = (t, nodeId = "LLMNode_1") => frame({ status: "streaming", nodeId, data: { generatedResponse: t } });
const finished = (data) => frame({ status: "success", data, isFlowExecutionFinished: true });

// Each test sets what the server answers; requests are recorded for assertions.
let respond;
let requests = [];
let server;
let lamatic;

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    requests.push({ headers: req.headers, body: JSON.parse(body) });
    await respond(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  lamatic = new Lamatic({
    endpoint: `http://127.0.0.1:${server.address().port}/graphql`,
    projectId: "project-1",
    apiKey: "key-1",
  });
});

after(() => server.close());

const sse = (...frames) => (res) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const f of frames) res.write(f);
  res.end();
};

const collect = async (gen) => {
  const events = [];
  for await (const e of gen) events.push(e);
  return events;
};

test("streams tokens and accumulates the text", async () => {
  requests = [];
  respond = sse(
    frame({ status: "success", nodeId: "trigger", data: {}, isNodeExecutionFinished: true }),
    frame(null),
    ": keep-alive\n\n",
    token("Hel"),
    token("lo").replace(/\n/g, "\r\n"),
    // The platform currently doubles generatedResponse on this frame.
    frame({ status: "success", nodeId: "LLMNode_1", data: { generatedResponse: "HelloHello", _meta: { total_tokens: 2 } }, isNodeExecutionFinished: true }),
    finished({ answer: "ok" }),
    token("late"),
  );

  const events = await collect(lamatic.executeFlowTokenStream("flow-1", { q: "hi" }, { source: "api" }));

  assert.deepEqual(events.map((e) => e.type), ["node", "token", "token", "node", "final"]);
  assert.deepEqual(events.filter((e) => e.type === "token").map((e) => e.token), ["Hel", "lo"]);
  const final = events.at(-1);
  assert.equal(final.text, "Hello");
  assert.deepEqual(final.textByNode, { LLMNode_1: "Hello" });
  assert.deepEqual(final.result, { answer: "ok" });
  assert.equal(events[3].raw.data._meta.total_tokens, 2);

  const [req] = requests;
  assert.equal(req.headers.accept, "text/event-stream");
  assert.equal(req.headers.authorization, "Bearer key-1");
  assert.match(req.body.query, /^subscription ExecuteWorkflowWithStream/);
  assert.match(req.body.query.replace(/\s+/g, " "), /command: \$command \) }$/);
  assert.deepEqual(req.body.variables, { workflowId: "flow-1", payload: { q: "hi" }, source: "api" });
});

test("a fatal error frame ends the stream", async () => {
  respond = sse(
    token("Hi"),
    frame({ status: "error", nodeId: "LLMNode_1", data: { errorMsg: "model unavailable" }, isFlowExecutionFinished: true }),
  );
  const events = await collect(lamatic.executeFlowTokenStream("flow-1", {}));
  assert.deepEqual(events.map((e) => e.type), ["token", "error"]);
  assert.equal(events[1].message, "model unavailable");
  assert.equal(events[1].nodeId, "LLMNode_1");
});

test("a non-fatal error frame does not end the stream", async () => {
  respond = sse(frame({ status: "error", data: { errorMsg: "soft" } }), token("go"), finished({}));
  const events = await collect(lamatic.executeFlowTokenStream("flow-1", {}));
  assert.deepEqual(events.map((e) => e.type), ["error", "token", "final"]);
});

test("a stream that closes before the flow finishes reports an error", async () => {
  respond = sse(token("Hi"));
  const events = await collect(lamatic.executeFlowTokenStream("flow-1", {}));
  assert.deepEqual(events.map((e) => e.type), ["token", "error"]);
  assert.equal(events[1].message, "Stream ended before the flow finished");
});

test("GraphQL errors inside the stream surface as one error", async () => {
  respond = sse(`data: ${JSON.stringify({ errors: [{ message: "Subscription error" }] })}\n\n`);
  const events = await collect(lamatic.executeFlowTokenStream("flow-1", {}));
  assert.deepEqual(events.map((e) => [e.type, e.message]), [["error", "Subscription error"]]);
});

test("a JSON error response surfaces as one error", async () => {
  respond = (res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ errors: [{ message: "Access Denied" }] }));
  };
  const events = await collect(lamatic.executeFlowTokenStream("flow-1", {}));
  assert.deepEqual(events.map((e) => [e.type, e.message]), [["error", "Access Denied"]]);
});

test("a non-JSON response surfaces as one error", async () => {
  respond = (res) => {
    res.writeHead(502, { "content-type": "text/html" });
    res.end("<html>Bad gateway</html>");
  };
  const events = await collect(lamatic.executeFlowTokenStream("flow-1", {}));
  assert.deepEqual(events.map((e) => [e.type, e.message]), [["error", "Unexpected non-streaming response (HTTP 502)"]]);
});

const slowTokens = (res) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  let i = 0;
  const timer = setInterval(() => res.write(token(`t${i++}`)), 20);
  res.on("close", () => clearInterval(timer));
};

test("aborting ends the stream quietly", async () => {
  respond = slowTokens;
  const controller = new AbortController();
  const events = [];
  for await (const e of lamatic.executeFlowTokenStream("flow-1", {}, { signal: controller.signal })) {
    events.push(e);
    if (events.length === 2) controller.abort();
  }
  assert.deepEqual(events.map((e) => e.type), ["token", "token"]);
});

test("breaking out early closes the connection", async () => {
  let closed;
  const closedPromise = new Promise((resolve) => (closed = resolve));
  respond = (res) => {
    res.on("close", closed);
    slowTokens(res);
  };
  for await (const e of lamatic.executeFlowTokenStream("flow-1", {})) {
    if (e.type === "token") break;
  }
  await closedPromise;
});

test("executeFlowStream keeps its chunk shape", async () => {
  respond = sse(token("a"), token("b"), finished({ x: 1 }));
  const chunks = await collect(lamatic.executeFlowStream("flow-1", {}));
  assert.deepEqual(chunks, [
    { event: "data", data: "a", done: false },
    { event: "data", data: "b", done: false },
    { event: "result", data: { x: 1 }, done: false },
    { event: "done", done: true },
  ]);
});
