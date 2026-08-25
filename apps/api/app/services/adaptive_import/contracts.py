from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

SourceMode = Literal["JSON", "MARKDOWN", "JSON_MARKDOWN", "UNKNOWN"]
ResolutionStatus = Literal["EXACT_MATCH", "COMPATIBLE", "DRIFTED", "AMBIGUOUS", "UNKNOWN", "INVALID"]
HandlingClass = Literal["SUPPORTED", "MAPPABLE", "NOT_MAPPABLE"]
CANONICAL_ROLES = frozenset({"user", "assistant", "system", "developer", "tool"})


@dataclass(frozen=True)
class SourceDocument:
    artifact_id: str
    filename: str
    extension: str
    content: bytes


@dataclass(frozen=True)
class AnalysisResult:
    mode: SourceMode
    signature: dict[str, Any]
    signature_digest: str
    mapping_candidates: dict[str, Any]
    diagnostics: list[dict[str, Any]] = field(default_factory=list)
    semantic: dict[str, Any] = field(default_factory=dict)
    handling_class: HandlingClass = "MAPPABLE"


@dataclass(frozen=True)
class MatchResult:
    status: ResolutionStatus
    profile_key: str | None
    profile_id: str | None
    revision_id: str | None
    profile_name: str | None
    evidence: dict[str, Any] = field(default_factory=dict)


class AdaptiveImportError(ValueError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        layer: str,
        pointer: str | None = None,
        blocking: bool = True,
        action: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.layer = layer
        self.pointer = pointer
        self.blocking = blocking
        self.action = action

    def diagnostic(self, *, group_id: str | None = None) -> dict[str, Any]:
        return {
            "code": self.code,
            "layer": self.layer,
            "message": str(self),
            "pointer": self.pointer,
            "blocking": self.blocking,
            "action": self.action,
            "group_id": group_id,
        }
