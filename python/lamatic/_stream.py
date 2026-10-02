"""Transport-independent helpers for token streaming.

The sync and async clients differ only in how they read lines off the wire;
everything else (SSE framing, GraphQL envelope unwrapping, turning raw chunks
into typed events) lives here so the two cannot drift apart.
"""

import json
from typing import Any

from .types import (
    LamaticTokenEventError,
    LamaticTokenEventFinal,
    LamaticTokenEventNode,
    LamaticTokenEvent,
    LamaticTokenEventToken,
)

# The `executeWorkflowWithStream` field returns a `JSON!` scalar, so it takes no
# selection set. It must be a subscription: the server only answers with
# text/event-stream for subscriptions, a query falls through to plain JSON.
STREAM_SUBSCRIPTION = """
    subscription ExecuteWorkflowWithStream(
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
    }
"""


def build_stream_request(
    flow_id: str,
    payload: dict,
    source: str | None,
    command: str | None,
) -> dict[str, Any]:
    variables: dict[str, Any] = {"workflowId": flow_id, "payload": payload}
    if source is not None:
        variables["source"] = source
    if command is not None:
        variables["command"] = command
    return {"query": STREAM_SUBSCRIPTION, "variables": variables}


def error_chunk(message: str) -> dict[str, Any]:
    return {
        "status": "error",
        "data": {"errorMsg": message},
        "isFlowExecutionFinished": True,
    }


def chunk_from_json_response(body: str, status_code: int) -> dict[str, Any]:
    """Build a terminal chunk from a non-streaming response body.

    Auth failures, rate limits and query-validation errors come back as plain JSON.
    """
    try:
        parsed = json.loads(body)
    except ValueError:
        return error_chunk(f"Unexpected non-streaming response (HTTP {status_code})")

    if not isinstance(parsed, dict):
        return error_chunk(f"Unexpected non-streaming response (HTTP {status_code})")

    if parsed.get("errors"):
        return error_chunk(parsed["errors"][0].get("message", "Workflow execution failed"))

    data = parsed.get("data") or {}
    result = data.get("executeWorkflowWithStream") or data.get("executeWorkflow") or {}
    if not isinstance(result, dict):
        result = {}
    inner = result.get("result")
    return {
        "status": result.get("status", "success"),
        "data": inner if inner is not None else (result or None),
        "isFlowExecutionFinished": True,
    }


class SSEChunkParser:
    """Feeds on SSE lines and emits one raw chunk per frame.

    A frame is a run of lines ended by a blank line. Only `data:` lines matter;
    multi-line `data:` fields are joined, and `:` comment lines (keep-alives)
    are ignored.
    """

    def __init__(self) -> None:
        self._data_lines: list[str] = []

    def push(self, line: str) -> dict[str, Any] | None:
        if line == "":
            return self.flush()
        if line.startswith(":"):
            return None
        if line.startswith("data:"):
            value = line[5:]
            self._data_lines.append(value[1:] if value.startswith(" ") else value)
        return None

    def flush(self) -> dict[str, Any] | None:
        """Parse and clear the pending frame. Call once more when the stream ends."""
        data_lines, self._data_lines = self._data_lines, []
        if not data_lines:
            return None

        raw = "\n".join(data_lines)
        if raw == "[DONE]":
            return {"isFlowExecutionFinished": True}
        try:
            envelope = json.loads(raw)
        except ValueError:
            return None
        if not isinstance(envelope, dict):
            return None

        errors = envelope.get("errors")
        if errors:
            return error_chunk(errors[0].get("message", "Workflow execution failed"))

        # The server also emits frames with a null payload; nothing to report.
        chunk = (envelope.get("data") or {}).get("executeWorkflowWithStream")
        return chunk if isinstance(chunk, dict) else None


def _first_not_none(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


class TokenEventAssembler:
    """Turns raw stream chunks into typed events, accumulating token text."""

    def __init__(self) -> None:
        self._text: list[str] = []
        self._text_by_node: dict[str, str] = {}
        self.finished = False

    def feed(self, chunk: dict[str, Any]) -> list[LamaticTokenEvent]:
        node_id = chunk.get("nodeId")
        data = chunk.get("data")

        if chunk.get("status") == "error":
            body = _first_not_none(data, chunk.get("result")) or {}
            event = LamaticTokenEventError(
                message=body.get("errorMsg") or "Workflow execution failed",
                node_id=node_id,
                raw=chunk,
            )
            if chunk.get("isFlowExecutionFinished"):
                self.finished = True
            return [event]

        # A token frame: `status: "streaming"` with a single delta in `data`.
        if chunk.get("status") == "streaming" and not chunk.get("isNodeExecutionFinished"):
            token = (data or {}).get("generatedResponse")
            if isinstance(token, str) and token != "":
                self._text.append(token)
                if node_id:
                    self._text_by_node[node_id] = self._text_by_node.get(node_id, "") + token
                return [LamaticTokenEventToken(token=token, node_id=node_id, raw=chunk)]
            return []

        # Checked before `isNodeExecutionFinished`: the terminal frame can set both.
        if chunk.get("isFlowExecutionFinished"):
            self.finished = True
            return [
                LamaticTokenEventFinal(
                    result=_first_not_none(data, chunk.get("result")),
                    text="".join(self._text),
                    text_by_node=dict(self._text_by_node),
                    raw=chunk,
                )
            ]

        if chunk.get("isNodeExecutionFinished"):
            return [LamaticTokenEventNode(node_id=node_id, output=data, raw=chunk)]

        return []

    def truncated(self) -> LamaticTokenEventError:
        """The connection closed without a terminal frame."""
        return LamaticTokenEventError(message="Stream ended before the flow finished")
