import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.share import Share
from app.models.user import User
from app.schemas.share import ShareCreate, ShareUpdate
from app.services.ownership import OwnershipScope
from app.services.sharing.share_service import ShareError, create_share, list_owned_shares, revoke_share, update_share
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def test_concurrent_share_revocation_and_owner_query(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        user = User(normalized_email="share-concurrency@example.test")
        other = User(normalized_email="share-other@example.test")
        db.add_all([user, other]); db.flush()
        source = Conversation(owner_user_id=user.id, title="Synthetic", display_title="Synthetic", source_type="test", source_profile="test", parser_version="test")
        db.add(source); db.flush()
        scope, other_scope = OwnershipScope(user.id), OwnershipScope(other.id)
        share = create_share(db, source.id, ShareCreate(), scope).share
        share_id = share.id
        db.commit()
    barrier = Barrier(2)

    def revoke(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            revoked = revoke_share(db, share_id, scope)
            db.commit()
            return revoked.revoked_at

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(revoke, range(2)))
    assert results[0] == results[1]
    with Session(engine) as db:
        assert db.query(Share).filter(Share.revoked_at.is_not(None)).count() == 1
        assert db.query(ConversationEvent).filter(ConversationEvent.event_type == "share_revoked").count() == 1
        assert list_owned_shares(db, scope, status="revoked").total == 1
        assert list_owned_shares(db, other_scope).total == 0
        with pytest.raises(ShareError) as failure:
            update_share(db, share_id, ShareUpdate(title="Cannot revive"), scope)
        assert failure.value.status_code == 410
