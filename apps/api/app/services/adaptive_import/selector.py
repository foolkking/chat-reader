from __future__ import annotations

import re
from typing import Any

from app.services.adaptive_import.contracts import AdaptiveImportError

_SEGMENT_RE = re.compile(r"^(?P<name>[A-Za-z0-9_@-]+)(?P<array>\[\*\])?$")


def evaluate_selector(value: Any, selector: str) -> list[Any]:
    """Evaluate a deliberately small, non-executable JSON selector subset."""
    if selector == "$":
        return [value]
    if not selector.startswith("$.") and selector != "$[*]":
        raise AdaptiveImportError("SELECTOR_INVALID", f"Unsupported selector: {selector}", layer="mapping", pointer=selector)
    current = [value]
    segments = ["[*]"] if selector == "$[*]" else selector[2:].split(".")
    for segment in segments:
        if segment == "[*]":
            current = [item for candidate in current if isinstance(candidate, list) for item in candidate]
            continue
        match = _SEGMENT_RE.fullmatch(segment)
        if match is None:
            raise AdaptiveImportError("SELECTOR_INVALID", f"Unsupported selector: {selector}", layer="mapping", pointer=selector)
        selected: list[Any] = []
        for candidate in current:
            if not isinstance(candidate, dict) or match.group("name") not in candidate:
                continue
            child = candidate[match.group("name")]
            if match.group("array"):
                if isinstance(child, list):
                    selected.extend(child)
            else:
                selected.append(child)
        current = selected
    return current


def select_one(value: Any, selector: str | None, default: Any = None) -> Any:
    if not selector:
        return default
    selected = evaluate_selector(value, selector)
    return selected[0] if selected else default
