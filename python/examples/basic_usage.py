"""
Basic usage examples for the Lamatic Python SDK.
"""

import asyncio
from lamatic import Lamatic


# Config

lamatic = Lamatic(
    endpoint="https://yourproject.lamatic.dev/graphql",
    project_id="projectid",
    api_key="your api key",
)



#Execute a flow (sync)


def run_flow():
    response = lamatic.execute_flow(
        flow_id="flowid",  # workflow/flow ID
        payload={"prompt": "Hello, Lamatic!"},
    )
    print("Status:", response.status)
    print("Result:", response.result)
    print("Message:", response.message)



# Poll status (sync)


def poll_status(request_id: str):
    response = lamatic.check_status(
        request_id=request_id,
        poll_interval=5,   # seconds between polls
        poll_timeout=120,  # max wait time in seconds
    )
    print("Status:", response.status)
    print("Result:", response.result)

# Async flow execution

async def run_flow_async():
    response = await lamatic.async_execute_flow(
        flow_id="flowid",
        payload={"prompt": "Hello from async!"},
    )
    print("Status:", response.status)
    print("Result:", response.result)
    print("Message:", response.message)

# Token streaming (sync)

def stream_flow():
    for event in lamatic.execute_flow_token_stream("flowid", {"sampleInput": "Tell me a story"}):
        if event.type == "token":
            print(event.token, end="", flush=True)
        elif event.type == "final":
            print("\nFull text:", event.text)
        elif event.type == "error":
            print("\nStream failed:", event.message)

# Token streaming (async)

async def stream_flow_async():
    async for event in lamatic.async_execute_flow_token_stream("flowid", {"sampleInput": "Tell me a story"}):
        if event.type == "token":
            print(event.token, end="", flush=True)
        elif event.type == "error":
            print("\nStream failed:", event.message)

# Token refresh

def refresh_token():
    lamatic.update_access_token("new-access-token")
    print("Token updated.")


if __name__ == "__main__":
    run_flow()
    asyncio.run(run_flow_async())
