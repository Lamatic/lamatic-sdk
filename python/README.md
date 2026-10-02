# Lamatic Python SDK

Python SDK for [Lamatic](https://lamatic.ai).

**Requires Python 3.10+**

## Installation

```bash
pip install lamatic
```

### Install from source

```bash
git clone https://github.com/Lamatic/Lamatic-Python-SDK.git
cd Lamatic-Python-SDK
pip install -e .
```

### For development (includes test dependencies)

```bash
pip install -e ".[dev]"
```

## Quick Start

```python

from lamatic import Lamatic

lamatic = Lamatic(
    endpoint="https://your-project.lamatic.ai/api/graphql",
    project_id="your-project-id",
    api_key="your-api-key",
)

# Execute a flow (sync)
response = lamatic.execute_flow("flow-id", {"prompt": "Hello!"})
print(response.status)  # "success"
print(response.result)

# Poll status
response = lamatic.check_status("request-id", poll_interval=5, poll_timeout=120)

```

## Async Usage

```python

import asyncio
from lamatic import Lamatic

lamatic = Lamatic(
    endpoint="https://your-project.lamatic.ai/api/graphql",
    project_id="your-project-id",
    api_key="your-api-key",
)

async def main():
    response = await lamatic.async_execute_flow("flow-id", {"prompt": "Hello!"})
    print(response.status)
    print(response.result)

asyncio.run(main())

```

## Token Streaming

`execute_flow_token_stream` runs a flow and yields its LLM/RAG output one token at a time, so you can render text as it is generated instead of waiting for the whole flow to finish.

```python
for event in lamatic.execute_flow_token_stream("flow-id", {"sampleInput": "Hello"}):
    if event.type == "token":
        print(event.token, end="", flush=True)   # one text delta
    elif event.type == "node":
        print(f"\n[{event.node_id}] finished", event.output)
    elif event.type == "final":
        print("\nFull text:", event.text)
        print("Flow result:", event.result)
    elif event.type == "error":
        print("\nStream failed:", event.message)
```

An async variant, `async_execute_flow_token_stream`, works the same way with `async for`.

### Events

| `type` | Fields | Emitted when |
|---|---|---|
| `token` | `token`, `node_id`, `raw` | An LLM or RAG node produces a text delta |
| `node` | `node_id`, `output`, `raw` | Any node finishes; `output` is its full output |
| `final` | `result`, `text`, `text_by_node`, `raw` | The flow finishes — always the last event of a successful stream |
| `error` | `message`, `node_id`, `raw` | Execution failed; the stream ends if the failure was fatal |

Events are dataclasses, so `match event:` with `LamaticTokenEventToken()` etc. works too. Every event carries `raw`, the untouched server frame, for fields the typed event does not expose — such as `_meta` on a `node` event, which holds token counts and cost:

```python
if event.type == "node" and event.raw.get("data", {}).get("_meta"):
    meta = event.raw["data"]["_meta"]
    print(f"{meta['model_name']}: {meta['total_tokens']} tokens, ${meta['total_cost']}")
```

### Reading the generated text

Use `final.text` — every token concatenated in arrival order. Don't read `generatedResponse` off a node's output instead:

- A flow's final `result` contains only what its response node was configured to return, which often does not include the generated text at all.
- The platform currently returns a streaming node's `generatedResponse` with its content duplicated. `final.text` is built from the deltas, so it is correct.

For a flow with more than one streaming node, `final.text_by_node` keys the text by node ID.

Only **LLM** and **RAG** nodes emit `token` events. Every other node reports once, as a single `node` event when it completes.

### Errors and cancelling

Failures (bad credentials, network errors, a stream that closes before the flow finishes) arrive as an `error` event rather than an exception.

To stop early, `break` out of the loop. The generator is closed and the connection released. In async code, cancelling the consuming task does the same.

```python
async def main():
    async for event in lamatic.async_execute_flow_token_stream("flow-id", {"sampleInput": "Write a long story"}):
        if event.type == "token":
            print(event.token, end="", flush=True)
```

## Authentication

Either `api_key` or `access_token` is required:

```python

# API key auth
lamatic = Lamatic(endpoint=..., project_id=..., api_key="your-api-key")

# Access token auth
lamatic = Lamatic(endpoint=..., project_id=..., access_token="your-token")

# Refresh token at runtime
lamatic.update_access_token("new-token")

```
