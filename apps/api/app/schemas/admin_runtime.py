from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AdminExecutionIdentity(BaseModel):
    """A specific execution, never a command targeting whichever task is next."""
    model_config = ConfigDict(extra="forbid")
    task_kind: Literal["job", "import"]
    task_id: UUID
    execution_token: UUID
    attempt: int = Field(ge=1)
