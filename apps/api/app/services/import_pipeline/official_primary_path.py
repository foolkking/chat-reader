from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class PrimaryPathResult:
    primary_node_ids: list[str]
    primary_message_node_ids: list[str]
    branch_node_ids: list[str]
    branch_count: int
    warnings: list[str] = field(default_factory=list)


def resolve_primary_path(mapping: dict[str, Any], current_node: str | None) -> PrimaryPathResult:
    warnings: list[str] = []
    start_node = current_node

    if not start_node or start_node not in mapping:
        start_node = _fallback_message_node(mapping)
        warnings.append("current_node missing or not found; used fallback message node.")

    primary_reversed: list[str] = []
    visited: set[str] = set()
    cursor = start_node

    while cursor and cursor in mapping:
        if cursor in visited:
            warnings.append("Cycle detected while resolving official primary path.")
            break
        visited.add(cursor)
        primary_reversed.append(cursor)
        parent = mapping.get(cursor, {}).get("parent") if isinstance(mapping.get(cursor), dict) else None
        cursor = str(parent) if parent else None

    primary_node_ids = list(reversed(primary_reversed))
    primary_set = set(primary_node_ids)
    primary_message_node_ids = [node_id for node_id in primary_node_ids if _has_message(mapping.get(node_id))]
    branch_node_ids = [
        node_id
        for node_id, node in mapping.items()
        if node_id not in primary_set and _has_message(node)
    ]
    branch_count = sum(1 for node in mapping.values() if _child_count(node) > 1)

    return PrimaryPathResult(
        primary_node_ids=primary_node_ids,
        primary_message_node_ids=primary_message_node_ids,
        branch_node_ids=branch_node_ids,
        branch_count=branch_count,
        warnings=warnings,
    )


def _fallback_message_node(mapping: dict[str, Any]) -> str | None:
    for node_id, node in reversed(list(mapping.items())):
        if _has_message(node):
            return node_id
    return None


def _has_message(node: Any) -> bool:
    return isinstance(node, dict) and isinstance(node.get("message"), dict)


def _child_count(node: Any) -> int:
    if not isinstance(node, dict):
        return 0
    children = node.get("children")
    return len(children) if isinstance(children, list) else 0
