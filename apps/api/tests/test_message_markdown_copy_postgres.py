"""Opt-in disposable PostgreSQL: migration, source preservation and copy races."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import get_db
from app.main import app
from app.models.attachment import AssetDerivative, Attachment
from app.models.attachment_public_link import AttachmentPublicLink
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.assets.public_images import publish_images, save_svg_preview
from app.services.ownership import LEGACY_OWNERSHIP_SCOPE
from test_import_profile_postgres import isolated_schema, pytestmark  # noqa: F401
from test_message_markdown_copy import seed, png


def prepare(engine, monkeypatch, tmp_path):
    factory = sessionmaker(bind=engine, autoflush=False)
    def override():
        with factory() as db:
            yield db
    monkeypatch.setitem(app.dependency_overrides, get_db, override)
    return factory, seed(monkeypatch, tmp_path, LEGACY_OWNERSHIP_SCOPE.owner_user_id)


def snapshot(factory, case):
    with factory() as db:
        message = db.get(Message, uuid.UUID(case["message"]))
        version = db.get(MessageVersion, message.current_version_id)
        return (str(message.current_version_id), version.display_text, version.content_hash,
                sorted((str(row.id), str(row.asset_object_id), row.status) for row in db.query(Attachment)))


def test_upgrade_downgrade_revokes_links_without_changing_canonical_source(isolated_schema, monkeypatch, tmp_path):
    engine, migrate = isolated_schema
    # Seed using the current ORM only against its current schema, then exercise
    # the old-schema roundtrip. No old deployment runs new ORM writes.
    migrate("head")
    factory, case = prepare(engine, monkeypatch, tmp_path)
    migrate("20261017_0052", "downgrade")
    original = snapshot(factory, case)
    migrate("head")
    with factory() as db:
        assert db.query(AttachmentPublicLink).count() == 0
        publish_images(db, uuid.UUID(case["message"]), LEGACY_OWNERSHIP_SCOPE,
                       uuid.UUID(case["version"]), [uuid.UUID(case["raster"])])
        db.commit()
    assert snapshot(factory, case) == original
    migrate("20261017_0052", "downgrade")
    assert "attachment_public_links" not in sa.inspect(engine).get_table_names()
    assert snapshot(factory, case) == original
    migrate("head")
    with factory() as db:
        assert db.query(AttachmentPublicLink).count() == 0
    assert snapshot(factory, case) == original


def test_simultaneous_same_version_saves_reject_stale_hash_and_replay_one_receipt(isolated_schema, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from app.models.conversation_event import ConversationEvent
    engine, migrate = isolated_schema
    migrate("head")
    factory, case = prepare(engine, monkeypatch, tmp_path)
    monkeypatch.setenv("AUTH_ENABLED", "false")
    from app.core.config import get_settings
    get_settings.cache_clear()
    endpoint = f"/api/messages/{case['message']}"
    with TestClient(app, raise_server_exceptions=False) as client:
        baseline = client.patch(endpoint, json={"content_markdown": "Synthetic second version"}).json()["message_version"]
    barrier = Barrier(2)
    def write(index):
        with TestClient(app, raise_server_exceptions=False) as client:
            barrier.wait(timeout=10)
            return client.patch(endpoint, json={"content_markdown": f"Synthetic writer {index}",
                "base_version_id": baseline["id"], "base_content_hash": baseline["source_content_hash"],
                "save_mode": "replace_current", "operation_id": str(uuid.uuid4())})
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(write, range(2)))
    assert sorted(response.status_code for response in responses) == [200, 409]
    with factory() as db:
        assert db.query(MessageVersion).filter_by(message_id=uuid.UUID(case["message"])).count() == 2
    barrier = Barrier(2)
    operation_id = str(uuid.uuid4())
    payload = {"content_markdown": "Synthetic idempotent next version", "operation_id": operation_id}
    def replay(_):
        with TestClient(app, raise_server_exceptions=False) as client:
            barrier.wait(timeout=10)
            return client.patch(endpoint, json=payload)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(replay, range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json()["current_version_id"] == responses[1].json()["current_version_id"]
    with factory() as db:
        assert db.query(MessageVersion).filter_by(message_id=uuid.UUID(case["message"])).count() == 3
        assert db.query(ConversationEvent).filter_by(id=uuid.UUID(operation_id)).count() == 1


@pytest.mark.parametrize("same_message", [True, False], ids=["same-message", "different-messages"])
def test_concurrent_copies_keep_one_stable_capability(isolated_schema, monkeypatch, tmp_path, same_message):
    engine, migrate = isolated_schema
    migrate("head")
    factory, case = prepare(engine, monkeypatch, tmp_path)
    message_ids = [uuid.UUID(case["message"])] * 2
    versions = [uuid.UUID(case["version"])] * 2
    if not same_message:
        with factory() as db:
            source = db.get(Message, message_ids[0])
            version = db.get(MessageVersion, versions[0])
            second = Message(conversation_id=source.conversation_id, role="user", order_key="b")
            db.add(second)
            db.flush()
            second_version = MessageVersion(message_id=second.id, version_number=1, display_text=version.display_text,
                                            plain_text=version.plain_text, edit_type="manual", content_hash=version.content_hash)
            db.add(second_version)
            db.flush()
            second.current_version_id = second_version.id
            message_ids[1], versions[1] = second.id, second_version.id
            db.commit()
    barrier = Barrier(2)
    def copy(index):
        with factory() as db:
            barrier.wait(timeout=10)
            result = publish_images(db, message_ids[index], LEGACY_OWNERSHIP_SCOPE, versions[index],
                                    [uuid.UUID(case["raster"])])
            db.commit()
            return result
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(copy, range(2)))
    assert results[0] == results[1]
    with factory() as db:
        assert db.query(AttachmentPublicLink).count() == 1
        db.delete(db.get(Attachment, uuid.UUID(case["raster"])))
        db.commit()
        assert db.query(AttachmentPublicLink).count() == 0  # Actual FK cascade.


def test_concurrent_svg_previews_reuse_one_derivative(isolated_schema, monkeypatch, tmp_path):
    engine, migrate = isolated_schema
    migrate("head")
    factory, case = prepare(engine, monkeypatch, tmp_path)
    barrier = Barrier(2)
    def convert(_):
        with factory() as db:
            barrier.wait(timeout=10)
            save_svg_preview(db, uuid.UUID(case["svg"]), LEGACY_OWNERSHIP_SCOPE, case["svg_sha"], png(metadata=True))
            db.commit()
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(convert, range(2)))
    with Session(engine) as db:
        assert db.query(AssetDerivative).count() == 1
        assert db.query(AttachmentPublicLink).count() == 0
