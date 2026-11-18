"""Explicit opt-in for ordinary full CI on a fork; never authorizes historical reuse."""
import json
import os
import re
from pathlib import Path

OFFICIAL = "foolkking/chat-reader"


def full_repository():
    value = os.environ.get("UPDATE_DISTRIBUTION", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    identity = os.environ.get("GITHUB_REPOSITORY_ID", "")
    # The unmodified independent CI inspector has no release variables or
    # signing authority. Its full-run input must agree with runner AND event
    # identity. An image-only request may never opt in to a fork.
    if not value and os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())
        inputs = event.get("inputs") or {}
        value = inputs.get("distribution", "")
        if value and (inputs.get("quality_source_run_id") or event["repository"]["full_name"] != repo
                      or str(event["repository"]["id"]) != identity):
            raise ValueError("Distribution is not the runner's full qualification")
    if not value:
        return OFFICIAL
    if (
        not re.fullmatch(r"[1-9]\d*", identity)
        or not re.fullmatch(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+", repo)
        or value != repo + ":" + identity
    ):
        raise ValueError("Configured distribution does not match the exact Actions repository identity")
    return repo
