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



# Example 2: Execute an agent (sync)


def run_agent():
    response = lamatic.execute_agent(
        agent_id="your-agent-id",
        payload={"message": "Summarize this text"},
    )
    print("Status:", response.status)
    print("Result:", response.result)



# Example 3: Poll status (sync)


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

# Token refresh

def refresh_token():
    lamatic.update_access_token("new-access-token")
    print("Token updated.")


if __name__ == "__main__":
    run_flow()
    asyncio.run(run_flow_async())
