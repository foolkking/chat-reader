"""Offline revisions must distinguish accepted edits from stale sessions."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from sqlalchemy.orm import Session
import pytest

from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.search_document import SearchDocument
from app.services.editing.message_edit_service import edit_message
from app.services.conversation_revision import bump_offline_revision
from app.services.offline_packages import changed_conversations
from test_cleanup_postgres import isolated_schema, pytestmark, seed  # noqa: F401


def test_different_message_edits_from_stale_sessions_advance_revision(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    _, assistant_id = seed(engine)
    with Session(engine) as db:
        conversation_id = db.get(Message, assistant_id).conversation_id
        user_id = db.query(Message.id).filter(
            Message.conversation_id == conversation_id, Message.id != assistant_id
        ).scalar()

    with Session(engine) as first, Session(engine) as second:
        first_conversation = first.get(Conversation, conversation_id)
        second_conversation = second.get(Conversation, conversation_id)
        original_revision = second_conversation.offline_revision
        assert first_conversation.offline_revision == original_revision
        edit_message(first, user_id, "Synthetic first accepted change.")
        first.commit()
        intermediate_revision = first_conversation.offline_revision
        assert intermediate_revision > original_revision
        # An offline copy can be downloaded here, before the second save.
        assert second_conversation.offline_revision == original_revision
        edit_message(second, assistant_id, "Synthetic second accepted change.")
        second.commit()

    with Session(engine) as db:
        for message_id, expected in [
            (user_id, "Synthetic first accepted change."),
            (assistant_id, "Synthetic second accepted change."),
        ]:
            message = db.get(Message, message_id)
            assert db.get(MessageVersion, message.current_version_id).display_text == expected
        final = db.get(Conversation, conversation_id)
        assert final.offline_revision > intermediate_revision
        assert changed_conversations([final], {conversation_id: intermediate_revision}) == [final]


@pytest.mark.parametrize("rollback", [False, True])
def test_pending_increments_flush_as_integers_and_rollback_together(isolated_schema, rollback):
    engine, migrate = isolated_schema
    migrate("head")
    _, message_id = seed(engine)
    with Session(engine) as db:
        conversation_id = db.get(Message, message_id).conversation_id
        conversation = db.get(Conversation, conversation_id)
        before = conversation.offline_revision
        with db.no_autoflush:
            bump_offline_revision(conversation)
            bump_offline_revision(conversation)
        db.flush()
        assert conversation.offline_revision == before + 2
        bump_offline_revision(conversation)
        db.flush()
        assert conversation.offline_revision == before + 3
        if rollback:
            db.rollback()
        else:
            db.commit()
    with Session(engine) as db:
        assert db.get(Conversation, conversation_id).offline_revision == before + (0 if rollback else 3)


def test_annotation_touch_cannot_overwrite_another_sessions_edit(isolated_schema):
    from app.services.annotations import _touch_conversation
    engine, migrate = isolated_schema
    migrate("head")
    _, message_id = seed(engine)
    with Session(engine) as stale:
        conversation_id = stale.get(Message, message_id).conversation_id
        conversation = stale.get(Conversation, conversation_id)
        before = conversation.offline_revision
        with Session(engine) as writer:
            edit_message(writer, message_id, "Synthetic concurrent source update.")
            writer.commit()
            intermediate = writer.get(Conversation, conversation_id).offline_revision
        assert intermediate > before
        _touch_conversation(conversation)
        stale.flush()
        assert conversation.offline_revision == intermediate + 1
        stale.commit()
    with Session(engine) as db:
        assert db.get(Conversation, conversation_id).offline_revision == intermediate + 1


def test_simultaneous_independent_edits_have_distinct_offline_revisions(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    _, message_id = seed(engine)
    with Session(engine) as db:
        conversation_id = db.get(Message, message_id).conversation_id
        ids = [
            row[0] for row in db.query(Message.id).filter_by(conversation_id=conversation_id).all()
        ]
    ready = Barrier(2)

    def save(index):
        with Session(engine) as db:
            conversation = db.get(Conversation, conversation_id)
            before = conversation.offline_revision
            ready.wait(timeout=10)
            edit_message(db, ids[index], f"Synthetic parallel save {index}.")
            db.flush()
            revision = conversation.offline_revision
            assert isinstance(revision, int) and revision > before
            db.commit()
            return revision

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(save, index) for index in range(2)]
        revisions = [future.result(timeout=30) for future in futures]
    assert len(set(revisions)) == 2
    with Session(engine) as db:
        assert db.get(Conversation, conversation_id).offline_revision == max(revisions)
        for index, identity in enumerate(ids):
            message = db.get(Message, identity)
            assert db.get(MessageVersion, message.current_version_id).display_text == f"Synthetic parallel save {index}."
            indexed = db.query(SearchDocument).filter_by(message_id=identity, document_type="message").one()
            assert indexed.message_version_id == message.current_version_id
            assert indexed.plain_text == f"Synthetic parallel save {index}."
