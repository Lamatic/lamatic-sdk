import asyncio
import logging
import time

import httpx

from .types import LamaticResponse

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
