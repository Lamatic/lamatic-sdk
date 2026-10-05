import json

import pytest
import respx
import httpx

from lamatic import Lamatic
from lamatic.types import LamaticResponse


ENDPOINT = "https://test.lamatic.ai/api/graphql"
PROJECT_ID = "proj-123"
API_KEY = "test-api-key"


@pytest.fixture
def client():
    return Lamatic(endpoint=ENDPOINT, project_id=PROJECT_ID, api_key=API_KEY)


def test_missing_endpoint():
    with pytest.raises(ValueError, match="Endpoint"):
        Lamatic(endpoint="", project_id=PROJECT_ID, api_key=API_KEY)


def test_missing_project_id():
    with pytest.raises(ValueError, match="Project ID"):
        Lamatic(endpoint=ENDPOINT, project_id="", api_key=API_KEY)


def test_missing_credentials():
    with pytest.raises(ValueError, match="API key"):
        Lamatic(endpoint=ENDPOINT, project_id=PROJECT_ID)


def test_access_token_auth():
    c = Lamatic(endpoint=ENDPOINT, project_id=PROJECT_ID, access_token="tok-abc")
    headers = c._get_headers()
    assert "X-Lamatic-Signature" in headers
    assert "Authorization" not in headers


def test_api_key_auth(client):
    headers = client._get_headers()
    assert headers["Authorization"] == f"Bearer {API_KEY}"
    assert "X-Lamatic-Signature" not in headers


@respx.mock
def test_execute_flow_success(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(
        200,
        json={"data": {"executeWorkflow": {"status": "success", "result": {"answer": "42"}}}},
    ))
    result = client.execute_flow("flow-1", {"prompt": "hi"})
    assert result.status == "success"
    assert result.result == {"answer": "42"}
    assert result.status_code == 200


@respx.mock
def test_execute_flow_graphql_error(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(
        200,
        json={"errors": [{"message": "Flow not found"}]},
    ))
    result = client.execute_flow("bad-flow", {})
    assert result.status == "error"
    assert result.message == "Flow not found"


@respx.mock
def test_check_status_success(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(
        200,
        json={"data": {"checkStatus": {"status": "success", "result": {"done": True}}}},
    ))
    result = client.check_status("req-1", poll_interval=1, poll_timeout=5)
    assert result.status == "success"


@respx.mock
def test_check_status_timeout(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(
        200,
        json={"data": {"checkStatus": {"status": "in_progress", "result": None}}},
    ))
    result = client.check_status("req-slow", poll_interval=1, poll_timeout=2)
    assert result.status == "error"
    assert result.status_code == 408


@respx.mock
@pytest.mark.asyncio
async def test_async_execute_flow_success(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(
        200,
        json={"data": {"executeWorkflow": {"status": "success", "result": {"out": "yes"}}}},
    ))
    result = await client.async_execute_flow("flow-1", {"x": 1})
    assert result.status == "success"
    assert result.result == {"out": "yes"}


@respx.mock
@pytest.mark.asyncio
async def test_async_check_status_success(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(
        200,
        json={"data": {"checkStatus": {"status": "success", "result": {"done": True}}}},
    ))
    result = await client.async_check_status("req-1", poll_interval=1, poll_timeout=5)
    assert result.status == "success"
    assert result.result == {"done": True}


@respx.mock
@pytest.mark.asyncio
async def test_async_check_status_timeout(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(
        200,
        json={"data": {"checkStatus": {"status": "in_progress", "result": None}}},
    ))
    result = await client.async_check_status("req-slow", poll_interval=1, poll_timeout=2)
    assert result.status == "error"
    assert result.status_code == 408


def test_update_access_token(client):
    client.update_access_token("new-token-xyz")
    assert client.access_token == "new-token-xyz"
    headers = client._get_headers()
    assert headers["X-Lamatic-Signature"] == "new-token-xyz"


# --- Token streaming ---------------------------------------------------------


def _sse(*chunks, raw_frames=()):
    """Build an SSE body: one `data:` frame per chunk, wrapped in the GraphQL envelope."""
    frames = [
        "data: " + json.dumps({"data": {"executeWorkflowWithStream": c}}) for c in chunks
    ]
    return ("\n\n".join([*frames, *raw_frames]) + "\n\n").encode()


def _sse_response(body: bytes) -> httpx.Response:
    return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})


STREAM_CHUNKS = [
    {"status": "success", "nodeId": "trigger", "data": {"x": 1}, "isNodeExecutionFinished": True},
    {"status": "streaming", "nodeId": "llm", "data": {"generatedResponse": "Hel"}},
    {"status": "streaming", "nodeId": "llm", "data": {"generatedResponse": "lo"}},
    {
        "status": "success",
        "nodeId": "llm",
        "data": {"generatedResponse": "HelloHello", "_meta": {"total_tokens": 2}},
        "isNodeExecutionFinished": True,
    },
    {"status": "success", "data": {"answer": "done"}, "isFlowExecutionFinished": True},
]


@respx.mock
def test_token_stream_events(client):
    route = respx.post(ENDPOINT).mock(return_value=_sse_response(_sse(*STREAM_CHUNKS)))
    events = list(client.execute_flow_token_stream("flow-1", {"sampleInput": "hi"}))

    assert [e.type for e in events] == ["node", "token", "token", "node", "final"]
    assert [e.token for e in events if e.type == "token"] == ["Hel", "lo"]
    assert events[3].raw["data"]["_meta"] == {"total_tokens": 2}

    final = events[-1]
    assert final.text == "Hello"  # built from deltas, not the duplicated generatedResponse
    assert final.text_by_node == {"llm": "Hello"}
    assert final.result == {"answer": "done"}

    sent = json.loads(route.calls.last.request.content)
    assert sent["query"].lstrip().startswith("subscription")
    assert sent["variables"] == {"workflowId": "flow-1", "payload": {"sampleInput": "hi"}}
    assert route.calls.last.request.headers["accept"] == "text/event-stream"


@respx.mock
def test_token_stream_sends_source_and_command(client):
    route = respx.post(ENDPOINT).mock(return_value=_sse_response(_sse(STREAM_CHUNKS[-1])))
    list(client.execute_flow_token_stream("flow-1", {}, source="api", command="run"))
    variables = json.loads(route.calls.last.request.content)["variables"]
    assert variables["source"] == "api"
    assert variables["command"] == "run"


@respx.mock
def test_token_stream_ignores_comments_null_frames_and_bad_json(client):
    body = (
        b": keep-alive\n\n"
        b'data: {"data":{"executeWorkflowWithStream":null}}\n\n'
        b"data: not json\n\n"
        + _sse(STREAM_CHUNKS[1], STREAM_CHUNKS[-1])
    )
    respx.post(ENDPOINT).mock(return_value=_sse_response(body))
    events = list(client.execute_flow_token_stream("flow-1", {}))
    assert [e.type for e in events] == ["token", "final"]


@respx.mock
def test_token_stream_handles_crlf_framing(client):
    body = _sse(STREAM_CHUNKS[1], STREAM_CHUNKS[-1]).replace(b"\n", b"\r\n")
    respx.post(ENDPOINT).mock(return_value=_sse_response(body))
    events = list(client.execute_flow_token_stream("flow-1", {}))
    assert [e.type for e in events] == ["token", "final"]


@respx.mock
def test_token_stream_error_frame_is_fatal_when_flow_finished(client):
    chunks = [
        STREAM_CHUNKS[1],
        {
            "status": "error",
            "nodeId": "llm",
            "data": {"errorMsg": "model exploded"},
            "isFlowExecutionFinished": True,
        },
    ]
    respx.post(ENDPOINT).mock(return_value=_sse_response(_sse(*chunks)))
    events = list(client.execute_flow_token_stream("flow-1", {}))
    assert [e.type for e in events] == ["token", "error"]
    assert events[-1].message == "model exploded"
    assert events[-1].node_id == "llm"


@respx.mock
def test_token_stream_non_fatal_error_continues(client):
    chunks = [
        {"status": "error", "nodeId": "a", "data": {"errorMsg": "soft"}},
        STREAM_CHUNKS[-1],
    ]
    respx.post(ENDPOINT).mock(return_value=_sse_response(_sse(*chunks)))
    events = list(client.execute_flow_token_stream("flow-1", {}))
    assert [e.type for e in events] == ["error", "final"]


@respx.mock
def test_token_stream_json_error_response(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(
        200, json={"errors": [{"message": "Invalid API key"}]},
    ))
    events = list(client.execute_flow_token_stream("flow-1", {}))
    assert len(events) == 1
    assert events[0].type == "error"
    assert events[0].message == "Invalid API key"


@respx.mock
def test_token_stream_non_json_response(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(502, text="Bad Gateway"))
    events = list(client.execute_flow_token_stream("flow-1", {}))
    assert [e.type for e in events] == ["error"]
    assert "HTTP 502" in events[0].message


@respx.mock
def test_token_stream_graphql_errors_in_envelope(client):
    body = ("data: " + json.dumps({"errors": [{"message": "boom"}]}) + "\n\n").encode()
    respx.post(ENDPOINT).mock(return_value=_sse_response(body))
    events = list(client.execute_flow_token_stream("flow-1", {}))
    assert [e.type for e in events] == ["error"]
    assert events[0].message == "boom"


@respx.mock
def test_token_stream_truncated_stream_reports_error(client):
    respx.post(ENDPOINT).mock(return_value=_sse_response(_sse(STREAM_CHUNKS[1])))
    events = list(client.execute_flow_token_stream("flow-1", {}))
    assert [e.type for e in events] == ["token", "error"]


@respx.mock
def test_token_stream_network_failure_yields_error(client):
    respx.post(ENDPOINT).mock(side_effect=httpx.ConnectError("no route"))
    events = list(client.execute_flow_token_stream("flow-1", {}))
    assert [e.type for e in events] == ["error"]
    assert "no route" in events[0].message


@respx.mock
def test_token_stream_early_break_stops_cleanly(client):
    respx.post(ENDPOINT).mock(return_value=_sse_response(_sse(*STREAM_CHUNKS)))
    stream = client.execute_flow_token_stream("flow-1", {})
    first = next(stream)
    stream.close()
    assert first.type == "node"
    with pytest.raises(StopIteration):
        next(stream)


@respx.mock
@pytest.mark.asyncio
async def test_async_token_stream_events(client):
    respx.post(ENDPOINT).mock(return_value=_sse_response(_sse(*STREAM_CHUNKS)))
    events = [e async for e in client.async_execute_flow_token_stream("flow-1", {})]
    assert [e.type for e in events] == ["node", "token", "token", "node", "final"]
    assert events[-1].text == "Hello"


@respx.mock
@pytest.mark.asyncio
async def test_async_token_stream_json_error_response(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(
        200, json={"errors": [{"message": "Invalid API key"}]},
    ))
    events = [e async for e in client.async_execute_flow_token_stream("flow-1", {})]
    assert [e.type for e in events] == ["error"]
    assert events[0].message == "Invalid API key"


@respx.mock
@pytest.mark.asyncio
async def test_async_token_stream_network_failure_yields_error(client):
    respx.post(ENDPOINT).mock(side_effect=httpx.ConnectError("no route"))
    events = [e async for e in client.async_execute_flow_token_stream("flow-1", {})]
    assert [e.type for e in events] == ["error"]
