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
def test_execute_agent_success(client):
    respx.post(ENDPOINT).mock(return_value=httpx.Response(
        200,
        json={"data": {"executeAgent": {"status": "success", "result": {"reply": "done"}}}},
    ))
    result = client.execute_agent("agent-1", {"message": "hello"})
    assert result.status == "success"
    assert result.result == {"reply": "done"}


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



def test_update_access_token(client):
    client.update_access_token("new-token-xyz")
    assert client.access_token == "new-token-xyz"
    headers = client._get_headers()
    assert headers["X-Lamatic-Signature"] == "new-token-xyz"
