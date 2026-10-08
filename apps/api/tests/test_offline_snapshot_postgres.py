"""An offline package must not mix source states across concurrent edits."""
import json
import uuid
from zipfile import ZipFile

import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.editing.message_edit_service import edit_message
from app.services.offline_packages import build_offline_package
from app.services.ownership import OwnershipScope
from test_cleanup_postgres import isolated_schema, pytestmark, seed  # noqa: F401


@pytest.mark.parametrize("save_mode", ["create_version", "replace_current"])
@pytest.mark.parametrize("commit_progress", [False, True])
def test_offline_package_uses_one_source_snapshot(isolated_schema, tmp_path, monkeypatch, save_mode, commit_progress):
    engine, migrate = isolated_schema
    migrate("head")
    _, message_id = seed(engine)
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(tmp_path / "offline"))
    get_settings.cache_clear()
    try:
        with Session(engine) as db:
            edit_message(db, message_id, "Synthetic editable source before download.")
            db.commit()
            message = db.get(Message, message_id)
            conversation_id = message.conversation_id
            conversation = db.get(Conversation, conversation_id)
            owner = conversation.owner_user_id
            before_revision = conversation.offline_revision
            before_body = db.get(MessageVersion, message.current_version_id).display_text
            job = BackgroundJob(job_type="offline_package", owner_user_id=owner)
            db.add(job)
            db.commit()
            job_id = job.id
        edited = False

        def progress(phase, percent, processed, total):
            nonlocal edited
            if phase == "packaging_messages" and not edited:
                edited = True
                if commit_progress:
                    db.commit()  # Worker progress must not reset the read snapshot.
                with Session(engine) as writer:
                    edit_message(writer, message_id, "Synthetic replacement during download.", save_mode=save_mode)
                    writer.commit()

        with Session(engine) as db:
            artifact = build_offline_package(db, job_id=job_id, package_id=uuid.uuid4(),
                scope="conversation", conversation_id=conversation_id, project_id=None,
                include_assets="none", subject_key=str(owner), ownership_scope=OwnershipScope(owner),
                progress_callback=progress)
            db.commit()
            with ZipFile(artifact.storage_uri) as package:
                exported = json.loads(package.read("package.json"))["conversations"][0]
        assert edited
        with Session(engine) as db:
            assert db.get(Conversation, conversation_id).offline_revision > before_revision
        assert exported["offline_revision"] == before_revision
        saved = next(row for row in exported["messages"] if row["id"] == str(message_id))
        assert saved["current_version"]["display_text"] == before_body
        indexed = next(row for row in exported["search_documents"] if row["message_id"] == str(message_id))
        assert indexed["plain_text"] == before_body
    finally:
        get_settings.cache_clear()
