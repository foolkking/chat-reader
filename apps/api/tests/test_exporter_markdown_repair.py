import json
from contextlib import contextmanager
from uuid import UUID

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.annotation import ConversationAnnotation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.source_message_ref import SourceMessageRef
from app.services.import_pipeline.markdown_repair import repair_exporter_markdown_imports
from test_import_preview_api import client  # noqa: F401


def _pair_files() -> list[tuple[str, tuple[str, bytes, str]]]:
    payload = {
        "metadata": {"title": "Repair fixture", "powered_by": "ChatGPT Exporter"},
        "messages": [
            {"role": "Prompt", "say": "JSON question", "time": "2026-07-01 10:00:00"},
            {"role": "Response", "say": "JSON answer", "time": "2026-07-01 10:01:00"},
        ],
    }
    markdown = b'''# Repair fixture

## Prompt:
2026-07-01 10:00:00

## Markdown question

important question

## Response:
2026-07-01 10:01:00

### Markdown answer

important answer

```python
print("repaired")
```
'''
    return [
        ("files", ("repair.json", json.dumps(payload).encode(), "application/json")),
        ("files", ("repair.md", markdown, "text/markdown")),
    ]


@contextmanager
def _test_db():
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        yield db
    finally:
        try:
            next(generator)
        except StopIteration:
            pass


def _legacy_pair(client: TestClient) -> tuple[str, UUID]:
    preview = client.post("/api/imports/preview", files=_pair_files())
    assert preview.status_code == 200
    import_id = UUID(preview.json()["import_id"])
    commit = client.post(f"/api/imports/{import_id}/commit")
    assert commit.status_code == 200
    conversation_id = commit.json()["conversation_ids"][0]

    with _test_db() as db:
        rows = (
            db.query(MessageVersion, SourceMessageRef)
            .join(Message, Message.id == MessageVersion.message_id)
            .join(SourceMessageRef, SourceMessageRef.message_id == Message.id)
            .filter(Message.conversation_id == UUID(conversation_id))
            .all()
        )
        for index, (version, source_ref) in enumerate(rows):
            version.display_text = f"legacy JSON body {index}"
            version.plain_text = f"legacy JSON body {index}"
            source_ref.raw_metadata = {"display_source": "json"}
        db.commit()
    return conversation_id, import_id


def test_markdown_repair_creates_versions_rebuilds_indexes_and_is_idempotent(client: TestClient) -> None:
    conversation_id, import_id = _legacy_pair(client)
    with _test_db() as db:
        assistant, old_version = (
            db.query(Message, MessageVersion)
            .join(MessageVersion, MessageVersion.id == Message.current_version_id)
            .filter(Message.conversation_id == UUID(conversation_id), Message.role == "assistant")
            .one()
        )
        annotation = ConversationAnnotation(
            conversation_id=UUID(conversation_id),
            message_id=assistant.id,
            message_version_id=old_version.id,
            annotation_type="highlight",
            quote="important answer",
            prefix="",
            suffix="",
        )
        db.add(annotation)
        db.commit()

        preview = repair_exporter_markdown_imports(db, import_id=import_id, dry_run=True)
        assert preview.eligible_imports == 1
        assert preview.eligible_messages == 2
        assert preview.repaired_messages == 0

        applied = repair_exporter_markdown_imports(db, import_id=import_id, dry_run=False)
        db.commit()
        assert applied.repaired_imports == 1
        assert applied.repaired_messages == 2

        db.refresh(assistant)
        current = db.get(MessageVersion, assistant.current_version_id)
        assert current is not None
        assert current.version_number == 2
        assert current.created_by == "system"
        assert current.display_text.startswith("### Markdown answer")
        assert [block["block_type"] for block in current.blocks] == ["heading", "paragraph", "code"]
        db.refresh(annotation)
        assert annotation.message_version_id == current.id
        assert annotation.anchor_status == "remapped"
        assert client.get(f"/api/conversations/{conversation_id}/toc").json()["items"][0]["text"] == "Markdown question"
        assert client.get("/api/search", params={"q": "important answer"}).json()["total"] >= 1

        repeat = repair_exporter_markdown_imports(db, import_id=import_id, dry_run=False)
        assert repeat.repaired_imports == 0
        assert repeat.repaired_messages == 0


def test_markdown_repair_skips_manual_current_versions(client: TestClient) -> None:
    conversation_id, import_id = _legacy_pair(client)
    with _test_db() as db:
        message = db.query(Message).filter(Message.conversation_id == UUID(conversation_id)).first()
        assert message is not None
        manual = client.patch(f"/api/messages/{message.id}", json={"display_text": "manual body"})
        assert manual.status_code == 200
        result = repair_exporter_markdown_imports(db, import_id=import_id, dry_run=False)
        assert result.skipped_modified_messages == 1
