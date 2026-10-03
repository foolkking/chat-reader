from __future__ import annotations

import json
from typing import Any

from .model import MaintenanceError

FIELD_ORDER = [
    "State", "Status", "Lifecycle", "Scope", "Adoption", "Goal", "Parent", "Owner", "Actor", "As-of",
    "Supersedes", "Related", "Evidence", "History", "Supports", "Type", "Sequence", "Message-ID", "Version-ID", "Attachment-ID",
]

SECTION_ORDER: list[tuple[str, str]] = [
    ("evolution", "Evolution"),
    ("goals", "Current Goal Tree"),
    ("requirements", "Requirements"),
    ("constraints", "Constraints"),
    ("non_goals", "Non-goals"),
    ("conventions", "Working Conventions"),
    ("decisions", "Adopted Decisions"),
    ("topic_capsules", "Topic Capsules"),
]
OP_SECTION_ORDER: list[tuple[str, str]] = [
    ("workstreams", "Current Workstreams"),
    ("milestones", "Completed Milestones"),
    ("open_work", "Open Work"),
    ("defects", "Known Defects"),
    ("verification_debt", "Verification Debt"),
    ("blockers", "Blockers"),
    ("next_actions", "Next Actions"),
]
UNCERTAINTY_ORDER: list[tuple[str, str]] = [
    ("assumptions", "Assumptions"),
    ("unknowns", "Unknowns"),
    ("conflicts", "Conflicts"),
    ("retired_stubs", "Retired / Superseded Stubs"),
]


def _yaml_scalar(v: Any) -> str:
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        return str(v)
    s = str(v)
    if not s or any(c in s for c in ':#{}[],&*!|>\'"%@`') or s.strip() != s or "\n" in s:
        return json.dumps(s, ensure_ascii=False)
    return s


def _field_lines(name: str, value: Any) -> list[str]:
    if isinstance(value, list):
        out = [f"{name}:"]
        for x in value:
            if isinstance(x, (dict, list)):
                out.append(f"- {json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(',', ':'))}")
            else:
                out.append(f"- {x}")
        return out
    if isinstance(value, dict):
        return [f"{name}: {json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))}"]
    return [f"{name}: {'' if value is None else value}"]


def _render_object(obj: dict[str, Any]) -> list[str]:
    oid = obj.get("id")
    if not isinstance(oid, str) or not oid:
        raise MaintenanceError("Current object missing id", "candidate_current_object_invalid")
    title = obj.get("title")
    heading = f"### {oid}" + (f" — {title}" if isinstance(title, str) and title else "")
    out = [heading]
    fields = obj.get("fields") if isinstance(obj.get("fields"), dict) else {}
    keys = [k for k in FIELD_ORDER if k in fields] + sorted(k for k in fields if k not in FIELD_ORDER)
    for k in keys:
        out.extend(_field_lines(k, fields[k]))
    body = obj.get("body")
    if body not in (None, "", []):
        out.append("")
        if isinstance(body, str):
            out.extend(body.splitlines())
        elif isinstance(body, list):
            out.extend(f"- {x}" for x in body)
        else:
            out.append(json.dumps(body, ensure_ascii=False, sort_keys=True, indent=2))
    return out


def _render_object_section(title: str, values: Any) -> list[str]:
    if not values:
        return []
    if not isinstance(values, list):
        raise MaintenanceError(f"Current section {title} must be an array", "candidate_current_section_invalid")
    out = [f"## {title}", ""]
    for i, obj in enumerate(values):
        if not isinstance(obj, dict):
            raise MaintenanceError(f"Current section {title} contains non-object", "candidate_current_section_invalid")
        if i:
            out.append("")
        out.extend(_render_object(obj))
    return out


def render_current(
    current: dict[str, Any], *, conversation_id: str, revision: int, trust: str,
    coverage: dict[str, Any], source_fingerprint: dict[str, Any], index_path: str = "continuation/index.json",
) -> str:
    lines = [
        "---",
        "schema: chat-reader-continuation",
        "schema_version: 1.0.0",
        f"conversation_id: {_yaml_scalar(conversation_id)}",
        f"continuation_revision: {revision}",
        f"trust: {trust}",
        "coverage:",
        f"  seq_start: {coverage['seq_start']}",
        f"  seq_end: {coverage['seq_end']}",
        f"  message_count: {coverage['message_count']}",
        "  source_fingerprint:",
        f"    profile: {_yaml_scalar(source_fingerprint['profile'])}",
        f"    algorithm: {_yaml_scalar(source_fingerprint['algorithm'])}",
        f"    content: {_yaml_scalar(source_fingerprint['content'])}",
        f"    locators: {_yaml_scalar(source_fingerprint['locators'])}",
        f"index: {_yaml_scalar(index_path)}",
        "---",
        "",
        "# Continuation State",
    ]
    brief = current.get("continuation_brief")
    if isinstance(brief, str) and brief.strip():
        lines += ["", "## Continuation Brief", "", brief.strip()]

    lines += ["", "# Part A — Understanding & Durable Knowledge"]
    orientation = current.get("orientation") if isinstance(current.get("orientation"), dict) else {}
    if orientation:
        lines += ["", "## Orientation"]
        origin = orientation.get("origin")
        mission = orientation.get("current_mission")
        if isinstance(origin, str) and origin.strip():
            lines += ["", "### Origin", origin.strip()]
        if isinstance(mission, str) and mission.strip():
            lines += ["", "### Current Mission", mission.strip()]
    for key, title in SECTION_ORDER:
        sec = _render_object_section(title, current.get(key))
        if sec:
            lines += [""] + sec

    lines += ["", "# Part B — Operational Continuation"]
    state = current.get("state_at_boundary")
    if isinstance(state, str) and state.strip():
        lines += ["", "## State at Continuation Boundary", state.strip()]
    for key, title in OP_SECTION_ORDER:
        sec = _render_object_section(title, current.get(key))
        if sec:
            lines += [""] + sec

    uncertainty_written = False
    for key, title in UNCERTAINTY_ORDER:
        sec = _render_object_section(title, current.get(key))
        if sec:
            if not uncertainty_written:
                lines += ["", "# Uncertainty & Retired State"]
                uncertainty_written = True
            lines += [""] + sec

    deps = current.get("attachment_dependencies")
    evid = current.get("evidence_registry")
    if deps or evid:
        lines += ["", "# Evidence Appendix"]
    if deps:
        lines += [""] + _render_object_section("Attachment Dependencies", deps)
    if evid:
        lines += [""] + _render_object_section("Evidence Registry", evid)
    return "\n".join(lines).rstrip() + "\n"
