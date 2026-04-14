from dataclasses import dataclass
from typing import Any, Literal


LamaticStatus = Literal["success", "error"]


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
