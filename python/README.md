# Lmatic Python SDK

Python SDK for [Lamatic](https://lamatic.ai).

## Installation

```bash
pip install lamatic-python
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

# Execute an agent (sync)
response = lamatic.execute_agent("agent-id", {"message": "Summarize this"})

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
