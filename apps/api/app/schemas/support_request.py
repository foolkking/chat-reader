from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class RequestedLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")
    import_size_mb: int | None = Field(default=None, ge=1, le=10240, strict=True)
    merge_message_count: int | None = Field(default=None, ge=2, le=100000, strict=True)


class RequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    kind: Literal["LIMIT", "QUESTION", "ISSUE"]
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=20000)
    limits: RequestedLimits = Field(default_factory=RequestedLimits)
    notify_admin: bool = False
    notify_replies: bool = False

    @model_validator(mode="after")
    def validate_limits(self):
        has_limits = bool(self.limits.model_dump(exclude_none=True))
        if (self.kind == "LIMIT") != has_limits:
            raise ValueError("Limit requests need at least one requested limit; other requests cannot change limits.")
        return self


class RequestReply(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    base_revision: int = Field(ge=1)
    body: str = Field(min_length=1, max_length=20000)
    notify: bool = False


class RequestDecision(RequestReply):
    action: Literal["APPROVE", "REJECT", "RESOLVE", "REQUEST_INFO", "WITHDRAW"]
    limits: RequestedLimits = Field(default_factory=RequestedLimits)


class LimitOverrideUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    base_revision: int = Field(ge=0)
    limits: RequestedLimits
    reason: str = Field(min_length=1, max_length=2000)
