from app.services.import_pipeline.official_json_parser import OfficialConversationResult
from app.services.import_pipeline.official_normalizer import build_official_conversation_preview
from test_official_samples import official_single_conversation


def test_normalizer_maps_roles_content_metadata_and_source_refs() -> None:
    sample = official_single_conversation()
    conversation = OfficialConversationResult(
        title=sample["title"],
        create_time=sample["create_time"],
        update_time=sample["update_time"],
        mapping=sample["mapping"],
        current_node=sample["current_node"],
        external_conversation_id=sample["id"],
        node_count=4,
        message_node_count=3,
        branch_count=1,
    )

    preview = build_official_conversation_preview(conversation, "official_conversation_json")

    assert preview.source_profile == "official_conversation_json"
    assert preview.message_count == 2
    assert preview.messages[0].role == "user"
    assert preview.messages[0].plain_text_preview == "你好"
    assert preview.messages[1].role == "assistant"
    assert preview.messages[1].metadata_preview["model_slug"] == "gpt-test"
    assert preview.messages[1].source_node_id == "assistant-1"
    assert preview.messages[1].source_message_id == "message-assistant-1"
    assert preview.has_branches is True
    assert preview.branch_node_count == 1


def test_non_text_content_downgrades_to_placeholder() -> None:
    sample = official_single_conversation()
    sample["mapping"]["assistant-1"]["message"]["content"] = {"content_type": "multimodal_text", "parts": []}
    conversation = OfficialConversationResult(
        title=sample["title"],
        create_time=sample["create_time"],
        update_time=sample["update_time"],
        mapping=sample["mapping"],
        current_node=sample["current_node"],
        external_conversation_id=sample["id"],
        node_count=4,
        message_node_count=3,
        branch_count=1,
    )

    preview = build_official_conversation_preview(conversation, "official_conversation_json")

    assert preview.messages[1].plain_text_preview == "[非文本内容: multimodal_text]"
    assert preview.messages[1].warnings
