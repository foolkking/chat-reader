import json

from app.services.import_pipeline.official_json_parser import parse_official_json
from test_official_samples import official_single_conversation


def test_top_level_object_parses_single_official_conversation() -> None:
    result = parse_official_json(json.dumps(official_single_conversation()).encode())

    assert result.source_profile == "official_conversation_json"
    assert result.conversation_count == 1
    conversation = result.conversations[0]
    assert conversation.title == "Official Sample"
    assert conversation.current_node == "assistant-1"
    assert conversation.node_count == 4
    assert conversation.message_node_count == 3


def test_top_level_list_parses_multiple_conversations() -> None:
    result = parse_official_json(json.dumps([official_single_conversation(), official_single_conversation()]).encode())

    assert result.source_profile == "official_conversations_json"
    assert result.conversation_count == 2


def test_missing_current_node_gives_warning() -> None:
    sample = official_single_conversation()
    sample.pop("current_node")

    result = parse_official_json(json.dumps(sample).encode())

    assert "current_node is missing." in result.conversations[0].warnings


def test_invalid_mapping_gives_warning() -> None:
    sample = official_single_conversation()
    sample["mapping"] = []

    result = parse_official_json(json.dumps(sample).encode())

    assert "mapping is missing or not an object." in result.conversations[0].warnings
