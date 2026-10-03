"""Historical adopted-data fixture and preservation after API retirement."""
import uuid
from app.models.context_continuation import ContinuationRevision, ContinuationState
from app.services.continuation_validation import validate_candidate_members
from app.services.continuation_adoption import adopt_candidate
from app.services.ownership import LEGACY_OWNERSHIP_SCOPE, LEGACY_SUBJECT_KEY
from test_continuation_validation import valid_pair
from test_continuation_candidates import client, private_objects, database, root, seed_legacy_candidate  # noqa: F401


def seed_legacy_adopted(client, path):
    conversation_id = uuid.UUID(path.split('/')[3])
    candidate = seed_legacy_candidate(path, **valid_pair(conversation_id))
    with database() as db:
        validation = validate_candidate_members(db, conversation_id, uuid.UUID(str(candidate['id'])), LEGACY_OWNERSHIP_SCOPE, subject_key=LEGACY_SUBJECT_KEY)
        revision, state, _ = adopt_candidate(db, conversation_id, uuid.UUID(str(candidate['id'])), LEGACY_OWNERSHIP_SCOPE,
            validation_id=validation.id, base_generation=0, subject_key=LEGACY_SUBJECT_KEY)
        db.commit()
        return conversation_id, str(revision.id)


def test_legacy_adopted_bytes_remain_readable_and_directly_replaceable(client):
    path = root(client)
    cid, revision_id = seed_legacy_adopted(client, path)
    before = client.get(path + '/revisions/' + revision_id + '/members/current').content
    assert b'Synthetic current' in before
    changed = client.put(path + '/files', data={'base_generation': 1}, files={'current': ('current.md', b'# Direct replacement')})
    assert changed.status_code == 200, changed.text
    assert client.get(path + '/revisions/' + revision_id + '/members/current').content == before
    with database() as db:
        assert db.query(ContinuationRevision).filter_by(conversation_id=cid).count() == 2
        assert db.get(ContinuationState, cid).generation == 2
