from app.services.import_pipeline.official_primary_path import resolve_primary_path
from test_official_samples import official_single_conversation


def test_current_node_backtracks_to_root() -> None:
    mapping = official_single_conversation()["mapping"]

    result = resolve_primary_path(mapping, "assistant-1")

    assert result.primary_node_ids == ["root", "user-1", "assistant-1"]
    assert result.primary_message_node_ids == ["user-1", "assistant-1"]


def test_branch_node_does_not_enter_primary_messages() -> None:
    mapping = official_single_conversation()["mapping"]

    result = resolve_primary_path(mapping, "assistant-1")

    assert result.branch_count == 1
    assert result.branch_node_ids == ["assistant-alt"]
    assert "assistant-alt" not in result.primary_message_node_ids


def test_not_simple_create_time_sort() -> None:
    mapping = official_single_conversation()["mapping"]

    result = resolve_primary_path(mapping, "assistant-1")

    assert result.primary_message_node_ids[-1] == "assistant-1"
    assert "assistant-alt" not in result.primary_message_node_ids


def test_cycle_detection_warning() -> None:
    mapping = {
        "a": {"message": {"id": "a"}, "parent": "b", "children": ["b"]},
        "b": {"message": {"id": "b"}, "parent": "a", "children": ["a"]},
    }

    result = resolve_primary_path(mapping, "a")

    assert any("Cycle detected" in warning for warning in result.warnings)


def test_missing_current_node_uses_fallback_with_warning() -> None:
    mapping = official_single_conversation()["mapping"]

    result = resolve_primary_path(mapping, None)

    assert result.primary_message_node_ids
    assert any("fallback" in warning for warning in result.warnings)
