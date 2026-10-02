import asyncio
import logging
import time
from collections.abc import AsyncIterator, Iterator

import httpx

from ._stream import (
    SSEChunkParser,
    TokenEventAssembler,
    build_stream_request,
    chunk_from_json_response,
)
from .types import LamaticResponse, LamaticTokenEvent, LamaticTokenEventError

logger = logging.getLogger(__name__)


class Lamatic:
    """Python SDK for the Lamatic API."""

    name: str = "Lamatic SDK"

    def __init__(
        self,
        endpoint: str,
        project_id: str,
        api_key: str | None = None,
        access_token: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        if not endpoint:
            raise ValueError("Endpoint URL is required")
        if not project_id:
            raise ValueError("Project ID is required")
        if not api_key and not access_token:
            raise ValueError("API key or Access Token is required")

        self.endpoint = endpoint
        self.project_id = project_id
        self.api_key = api_key
        self.access_token = access_token
        self.timeout = timeout

    def _get_headers(self) -> dict[str, str]:
        if self.access_token:
            return {
                "Content-Type": "application/json",
                "X-Lamatic-Signature": self.access_token,
                "x-project-id": self.project_id,
            }
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "x-project-id": self.project_id,
        }

    def _parse_response(self, response: httpx.Response, operation: str) -> LamaticResponse:
        data = response.json()
        if "errors" in data:
            return LamaticResponse(
                status="error",
                result=None,
                message=data["errors"][0]["message"],
                status_code=response.status_code,
            )
        op_data = data["data"][operation]
        return LamaticResponse(
            status=op_data["status"],
            result=op_data.get("result"),
            message=op_data.get("message"),
            status_code=response.status_code,
        )

    def update_access_token(self, access_token: str) -> None:
        """Update the access token at runtime (e.g. after token refresh)."""
        self.access_token = access_token


    def execute_flow(self, flow_id: str, payload: dict) -> LamaticResponse:
        """Execute a workflow synchronously."""
        query = {
            "query": """
                query ExecuteWorkflow($workflowId: String!, $payload: JSON!) {
                    executeWorkflow(workflowId: $workflowId, payload: $payload) {
                        status
                        result
                    }
                }
            """,
            "variables": {"workflowId": flow_id, "payload": payload},
        }
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(self.endpoint, json=query, headers=self._get_headers())
            return self._parse_response(response, "executeWorkflow")
        except Exception as e:
            logger.error("executeFlow request failed: %s", e)
            raise

    def execute_flow_token_stream(
        self,
        flow_id: str,
        payload: dict,
        *,
        source: str | None = None,
        command: str | None = None,
    ) -> Iterator[LamaticTokenEvent]:
        """Execute a workflow and stream its LLM/RAG output one token at a time.

        Opens the ``executeWorkflowWithStream`` GraphQL subscription over
        Server-Sent Events and yields a typed event per frame:

        - ``token``: one text delta from a streaming node (LLM or RAG)
        - ``node``: a node finished; ``output`` holds its full output
        - ``final``: the flow finished; ``result`` is its output and ``text`` is
          every token concatenated
        - ``error``: execution failed; the stream ends if the failure was fatal

        Only LLM and RAG nodes stream token by token. Every other node reports
        once, as a single ``node`` event when it completes.

        Prefer ``final.text`` over reading ``generatedResponse`` off a node's
        output: the platform currently returns that field with its content
        duplicated, and a flow's final result often carries only what its
        response node was configured to return.

        Stop early by breaking out of the loop (or calling ``.close()`` on the
        generator); the connection is released.

        Example::

            for event in lamatic.execute_flow_token_stream(flow_id, {"sampleInput": "Hello"}):
                if event.type == "token":
                    print(event.token, end="", flush=True)
                elif event.type == "final":
                    print("\\n", event.text)
                elif event.type == "error":
                    print("failed:", event.message)
        """
        request = build_stream_request(flow_id, payload, source, command)
        assembler = TokenEventAssembler()
        try:
            for chunk in self._stream_chunks(request):
                yield from assembler.feed(chunk)
                if assembler.finished:
                    return
            yield assembler.truncated()
        except Exception as e:
            logger.error("executeFlowTokenStream request failed: %s", e)
            yield LamaticTokenEventError(message=str(e))

    def _stream_chunks(self, request: dict) -> Iterator[dict]:
        headers = {**self._get_headers(), "Accept": "text/event-stream"}
        with httpx.Client(timeout=self.timeout) as client:
            with client.stream("POST", self.endpoint, json=request, headers=headers) as response:
                content_type = response.headers.get("content-type", "")
                if "text/event-stream" not in content_type:
                    response.read()
                    yield chunk_from_json_response(response.text, response.status_code)
                    return

                parser = SSEChunkParser()
                for line in response.iter_lines():
                    chunk = parser.push(line)
                    if chunk is None:
                        continue
                    yield chunk
                    if chunk.get("isFlowExecutionFinished"):
                        return
                chunk = parser.flush()
                if chunk is not None:
                    yield chunk

    def check_status(
        self,
        request_id: str,
        poll_interval: int = 15,
        poll_timeout: int = 900,
    ) -> LamaticResponse:
        """Poll request status synchronously until completion or timeout."""
        query = {
            "query": """
                query CheckStatus($requestId: String!) {
                    checkStatus(requestId: $requestId) {
                        status
                        result
                    }
                }
            """,
            "variables": {"requestId": request_id},
        }
        start = time.monotonic()
        while time.monotonic() - start < poll_timeout:
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    response = client.post(self.endpoint, json=query, headers=self._get_headers())
                result = self._parse_response(response, "checkStatus")
                if result.status in ("success", "error", "failed"):
                    return result
            except Exception as e:
                logger.error("checkStatus request failed: %s", e)
                return LamaticResponse(status="error", result=None, message=str(e), status_code=500)

            remaining = poll_timeout - (time.monotonic() - start)
            if remaining <= 0:
                break
            time.sleep(min(poll_interval, remaining))

        return LamaticResponse(
            status="error",
            result=None,
            message=f"Request checkStatus timed out after {poll_timeout} seconds, your request may still be executing in the background.",
            status_code=408,
        )


    async def async_execute_flow(self, flow_id: str, payload: dict) -> LamaticResponse:
        """Execute a workflow asynchronously."""
        query = {
            "query": """
                query ExecuteWorkflow($workflowId: String!, $payload: JSON!) {
                    executeWorkflow(workflowId: $workflowId, payload: $payload) {
                        status
                        result
                    }
                }
            """,
            "variables": {"workflowId": flow_id, "payload": payload},
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(self.endpoint, json=query, headers=self._get_headers())
            return self._parse_response(response, "executeWorkflow")
        except Exception as e:
            logger.error("executeFlow request failed: %s", e)
            raise

    async def async_execute_flow_token_stream(
        self,
        flow_id: str,
        payload: dict,
        *,
        source: str | None = None,
        command: str | None = None,
    ) -> AsyncIterator[LamaticTokenEvent]:
        """Async variant of :meth:`execute_flow_token_stream`.

        Cancelling the consuming task, or breaking out of the ``async for`` loop
        (ideally via ``contextlib.aclosing``), stops generation and releases the
        connection.

        Example::

            async for event in lamatic.async_execute_flow_token_stream(flow_id, {"sampleInput": "Hello"}):
                if event.type == "token":
                    print(event.token, end="", flush=True)
        """
        request = build_stream_request(flow_id, payload, source, command)
        assembler = TokenEventAssembler()
        try:
            async for chunk in self._async_stream_chunks(request):
                for event in assembler.feed(chunk):
                    yield event
                if assembler.finished:
                    return
            yield assembler.truncated()
        except Exception as e:
            logger.error("asyncExecuteFlowTokenStream request failed: %s", e)
            yield LamaticTokenEventError(message=str(e))

    async def _async_stream_chunks(self, request: dict) -> AsyncIterator[dict]:
        headers = {**self._get_headers(), "Accept": "text/event-stream"}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream("POST", self.endpoint, json=request, headers=headers) as response:
                content_type = response.headers.get("content-type", "")
                if "text/event-stream" not in content_type:
                    await response.aread()
                    yield chunk_from_json_response(response.text, response.status_code)
                    return

                parser = SSEChunkParser()
                async for line in response.aiter_lines():
                    chunk = parser.push(line)
                    if chunk is None:
                        continue
                    yield chunk
                    if chunk.get("isFlowExecutionFinished"):
                        return
                chunk = parser.flush()
                if chunk is not None:
                    yield chunk

    async def async_check_status(
        self,
        request_id: str,
        poll_interval: int = 15,
        poll_timeout: int = 900,
    ) -> LamaticResponse:
        """Poll request status asynchronously until completion or timeout."""
        query = {
            "query": """
                query CheckStatus($requestId: String!) {
                    checkStatus(requestId: $requestId) {
                        status
                        result
                    }
                }
            """,
            "variables": {"requestId": request_id},
        }
        start = time.monotonic()
        while time.monotonic() - start < poll_timeout:
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.post(self.endpoint, json=query, headers=self._get_headers())
                result = self._parse_response(response, "checkStatus")
                if result.status in ("success", "error", "failed"):
                    return result
            except Exception as e:
                logger.error("checkStatus request failed: %s", e)
                return LamaticResponse(status="error", result=None, message=str(e), status_code=500)

            remaining = poll_timeout - (time.monotonic() - start)
            if remaining <= 0:
                break
            await asyncio.sleep(min(poll_interval, remaining))

        return LamaticResponse(
            status="error",
            result=None,
            message=f"Request checkStatus timed out after {poll_timeout} seconds, your request may still be executing in the background.",
            status_code=408,
        )
