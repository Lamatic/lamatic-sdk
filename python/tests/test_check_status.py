import json
from pathlib import Path

import httpx
import pytest
import respx

from lamatic import Lamatic


ENDPOINT = "https://test.lamatic.ai/api/graphql"

# Real API responses, shared with the TypeScript and Go SDK test suites.
FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "check_status.json").read_text())


@pytest.fixture
def client():
    return Lamatic(endpoint=ENDPOINT, project_id="proj-123", api_key="test-api-key")


def _replies(*names):
    """Answer one fixture per request, repeating the last one."""
    bodies = [FIXTURES[n] for n in names]
    calls = {"n": 0}

    def reply(request):
        body = bodies[min(calls["n"], len(bodies) - 1)]
        calls["n"] += 1
        return httpx.Response(200, json=body)

    return reply


@respx.mock
def test_check_status_returns_the_flows_result(client):
    route = respx.post(ENDPOINT).mock(side_effect=_replies("inProgress", "success"))
    result = client.check_status("req-1", poll_interval=0.01, poll_timeout=5)
    assert result.status == "success"
    assert result.result["answer"] == "hello async"
    assert result.status_code == 200
    assert route.call_count == 2
    query = json.loads(route.calls[0].request.content)["query"]
    assert "checkStatus(requestId: $requestId)\n" in query


@respx.mock
def test_check_status_reports_a_failed_runs_message(client):
    respx.post(ENDPOINT).mock(side_effect=_replies("failed"))
    result = client.check_status("req-1", poll_interval=0.01, poll_timeout=5)
    assert result.status == "failed"
    assert result.message.startswith("LLM node failed: 404")
    assert result.result["failedNode"]["nodeId"] == "LLMNode_110"


@respx.mock
def test_check_status_gives_up_on_an_unknown_request(client, monkeypatch):
    monkeypatch.setattr(Lamatic, "_not_found_grace", 0.03)
    respx.post(ENDPOINT).mock(side_effect=_replies("notFound"))
    result = client.check_status("req-missing", poll_interval=0.01, poll_timeout=5)
    assert result.status == "error"
    assert result.status_code == 404
    assert "req-missing was not found" in result.message


@respx.mock
def test_check_status_polls_through_not_found_during_the_grace_period(client):
    route = respx.post(ENDPOINT).mock(side_effect=_replies("notFound", "inProgress", "success"))
    result = client.check_status("req-1", poll_interval=0.01, poll_timeout=5)
    assert result.status == "success"
    assert route.call_count == 3


@respx.mock
def test_execute_flow_poll_polls_a_queued_run(client):
    route = respx.post(ENDPOINT).mock(side_effect=_replies("queued", "inProgress", "success"))
    result = client.execute_flow_poll("flow-1", {"sampleInput": "hi"}, poll_interval=0.01, poll_timeout=5)
    assert result.status == "success"
    assert result.result["answer"] == "hello async"
    request_id = FIXTURES["queued"]["data"]["executeWorkflow"]["result"]["requestId"]
    assert json.loads(route.calls[1].request.content)["variables"] == {"requestId": request_id}


@respx.mock
def test_execute_flow_poll_returns_a_realtime_response_without_polling(client):
    route = respx.post(ENDPOINT).mock(return_value=httpx.Response(
        200,
        json={"data": {"executeWorkflow": {"status": "success", "result": {"answer": "now", "requestId": "req-2"}}}},
    ))
    result = client.execute_flow_poll("flow-1", {}, poll_interval=0.01, poll_timeout=5)
    assert result.result["answer"] == "now"
    assert route.call_count == 1


@respx.mock
@pytest.mark.asyncio
async def test_async_execute_flow_poll_polls_a_queued_run(client):
    respx.post(ENDPOINT).mock(side_effect=_replies("queued", "inProgress", "success"))
    result = await client.async_execute_flow_poll("flow-1", {"sampleInput": "hi"}, poll_interval=0.01, poll_timeout=5)
    assert result.status == "success"
    assert result.result["answer"] == "hello async"


@respx.mock
@pytest.mark.asyncio
async def test_async_check_status_reports_a_failed_run(client):
    respx.post(ENDPOINT).mock(side_effect=_replies("inProgress", "failed"))
    result = await client.async_check_status("req-1", poll_interval=0.01, poll_timeout=5)
    assert result.status == "failed"
    assert result.message.startswith("LLM node failed: 404")


@respx.mock
def test_check_status_keeps_polling_through_a_dropped_connection(client):
    replies = iter([httpx.ConnectError("connection reset"), httpx.Response(200, json=FIXTURES["success"])])

    def reply(request):
        r = next(replies)
        if isinstance(r, Exception):
            raise r
        return r

    route = respx.post(ENDPOINT).mock(side_effect=reply)
    result = client.check_status("req-1", poll_interval=0.01, poll_timeout=5)
    assert result.status == "success"
    assert route.call_count == 2


@respx.mock
@pytest.mark.asyncio
async def test_async_check_status_reports_the_last_error_on_timeout(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(502, text="<html>Bad gateway</html>"))
    result = await client.async_check_status("req-1", poll_interval=0.01, poll_timeout=0.05)
    assert result.status_code == 408
    assert "Last error:" in result.message
