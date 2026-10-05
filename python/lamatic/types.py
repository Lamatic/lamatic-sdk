from dataclasses import dataclass, field
from typing import Any, Literal, Union


LamaticStatus = Literal["success", "error", "failed", "in_progress"]


@dataclass
class LamaticConfig:
    endpoint: str
    project_id: str
    api_key: str | None = None
    access_token: str | None = None


@dataclass
class LamaticResponse:
    status: LamaticStatus
    result: dict[str, Any] | None
    message: str | None = None
    status_code: int | None = None


@dataclass
class LamaticTokenEventToken:
    """A single token (text delta) produced by an LLM or RAG node."""

    token: str
    node_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)
    type: Literal["token"] = field(default="token", init=False)


@dataclass
class LamaticTokenEventNode:
    """A node finished executing; `output` is its full output."""

    node_id: str | None = None
    output: dict[str, Any] | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)
    type: Literal["node"] = field(default="node", init=False)


@dataclass
class LamaticTokenEventFinal:
    """The flow finished. Always the last event of a successful stream."""

    #: The flow's final output, as configured by its response node.
    result: dict[str, Any] | None
    #: Every token concatenated in arrival order.
    text: str
    #: Tokens concatenated per node, for flows with more than one streaming node.
    text_by_node: dict[str, str] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict, repr=False)
    type: Literal["final"] = field(default="final", init=False)


@dataclass
class LamaticTokenEventError:
    """Execution failed; the stream ends if the failure was fatal."""

    message: str
    node_id: str | None = None
    raw: dict[str, Any] | None = field(default=None, repr=False)
    type: Literal["error"] = field(default="error", init=False)


LamaticTokenEvent = Union[
    LamaticTokenEventToken,
    LamaticTokenEventNode,
    LamaticTokenEventFinal,
    LamaticTokenEventError,
]
