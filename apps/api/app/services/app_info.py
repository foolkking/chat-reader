"""Public build provenance, never runtime configuration or environment dumps."""

import json
import re
from pathlib import Path

API_VERSION = "0.12.0"
BUILD_METADATA_PATH = Path(__file__).parents[1] / "build_metadata.json"


def app_info() -> dict:
    revision = None
    try:
        with BUILD_METADATA_PATH.open(encoding="utf-8") as source:
            metadata = json.loads(source.read(256))
        candidate = metadata.get("revision") if isinstance(metadata, dict) else None
        if isinstance(candidate, str) and re.fullmatch(r"[0-9a-f]{40}", candidate):
            revision = candidate
    except (OSError, ValueError):
        pass
    return {"api_version": API_VERSION, "revision": revision}
