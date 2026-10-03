from __future__ import annotations

import json
import math
import re
from pathlib import PurePosixPath

_DRIVE_RE = re.compile(r"^[A-Za-z]:")


def load_protocol_json(text: str):
    """Reject ambiguous JSON and bound nesting before constructing objects."""
    depth = 0
    quoted = False
    escaped = False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            if depth > 64:
                raise ValueError("JSON nesting resource limit exceeded")
        elif char in "]}":
            depth -= 1

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON object key")
            result[key] = value
        return result

    def invalid_constant(_value):
        raise ValueError("nonfinite JSON value")

    def finite_float(value):
        parsed = float(value)
        if not math.isfinite(parsed):
            raise ValueError("nonfinite JSON value")
        return parsed

    return json.loads(text, object_pairs_hook=unique_object, parse_constant=invalid_constant,
                      parse_float=finite_float)


def normalize_member_name(name: str) -> str:
    return name.replace("\\", "/")


def is_safe_member_name(name: str) -> bool:
    norm = normalize_member_name(name)
    if not norm or len(norm) > 1024 or norm.count("/") > 32 or norm.startswith("/") or _DRIVE_RE.match(norm):
        return False
    parts = norm.rstrip("/").split("/")
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
    return all(part not in {".", "..", ""} and not part.endswith((".", " "))
               and not any(ord(c) < 32 or c in ':<>"|?*' for c in part)
               and part.split(".")[0].upper() not in reserved for part in parts)


def safe_materialized_filename(name: str | None, fallback: str = "attachment.bin") -> str:
    if not name:
        return fallback
    norm = normalize_member_name(name)
    base = PurePosixPath(norm).name
    if not base or base in {".", ".."}:
        base = fallback
    # Keep readable Unicode, remove filesystem separators/control-ish chars.
    base = base.replace("/", "_").replace("\\", "_")
    base = "".join(ch if ord(ch) >= 32 else "_" for ch in base)
    return base or fallback
