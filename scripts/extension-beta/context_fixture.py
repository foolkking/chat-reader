"""Seed the disposable Reader lab OR inspect its downloaded synthetic ZIP. Output only counts and policy."""
import hashlib
import json
import os
import re
import sys
import uuid
import zipfile


def marks(label):
    assert re.fullmatch("[a-z0-9-]{1,80}", label)
    prefix = "ctx-test-" + hashlib.sha256(label.encode()).hexdigest()[:16] + "-"
    return {k: prefix + k for k in ("my-annotation", "my-notebook", "other-annotation", "other-notebook", "conflict-draft")}


def seed(cid, label):
    assert os.environ["APP_ENV"] == "test" and os.environ["PUBLIC_WEB_BASE_URL"] == os.environ["SYNTHETIC_ORIGIN"] in {"http://127.0.0.1:18383","http://127.0.0.1:18483"}
    from sqlalchemy import select
    from app.core.database import SessionLocal
    from app.models import _register_all_models
    from app.models.annotation import ConversationAnnotation, ConversationNotebook
    from app.models.conversation import Conversation
    from app.models.message import Message
    from app.models.user import User

    _register_all_models()
    m = marks(label)
    with SessionLocal() as db:
        assert db.get_bind().url.database == "extension_beta"
        conv = db.get(Conversation, uuid.UUID(cid))
        assert conv.display_title == "Tide notebook · " + label and conv.message_count == 4
        owner = db.get(User, conv.owner_user_id)
        assert owner.normalized_email == "browser-beta@example.test"
        assert not db.scalar(select(ConversationNotebook.id).where(ConversationNotebook.conversation_id == conv.id).limit(1))
        other = User(normalized_email=m["other-notebook"] + "@example.test", role="USER", status="DISABLED")
        db.add(other)
        db.flush()
        first = db.scalars(select(Message).where(Message.conversation_id == conv.id).order_by(Message.order_key)).first()
        for subject, annotation, notebook in ((owner, "my-annotation", "my-notebook"), (other, "other-annotation", "other-notebook")):
            db.add(ConversationAnnotation(subject_key=str(subject.id), conversation_id=conv.id, message_id=first.id,
                                         message_version_id=first.current_version_id, comment_markdown=m[annotation]))
            db.add(ConversationNotebook(subject_key=str(subject.id), conversation_id=conv.id, blocks=[
                {"type": "markdown", "markdown": m[notebook]}]))
        db.add(ConversationNotebook(subject_key=str(owner.id), conversation_id=conv.id, is_conflict=True,
                                    blocks=[{"type": "markdown", "markdown": m["conflict-draft"]}]))
        db.commit()
    return {"subjects": 2, "annotations": 2, "notebooks": 3}


def check(filename, cid, label, policy, csv_sha, png_sha):
    uuid.UUID(cid)
    assert policy in ("include", "metadata_only")
    m = marks(label)
    with zipfile.ZipFile(filename) as z:
        # This fixture is small. No extraction, raw data, source IDs or claims in results.
        assert sum(i.file_size for i in z.infolist()) < 4 * 1024 * 1024 and z.testzip() is None
        names = z.namelist()
        assert len(names) == len(set(names))
        member = {n: z.read(n) for n in names}
    manifest = json.loads(member["manifest.json"])
    assert manifest["scope"]["conversation_id"] == cid and manifest["scope"]["is_complete_conversation"] is True
    assert manifest["attachments"]["policy"] == policy, "Downloaded bytes used the wrong attachment policy"
    assert manifest["extensions"]["chat_reader_continuation_export"]["status"] == (
        "none" if policy == "metadata_only" else "omitted_by_request")
    assert set(manifest["files"]) == set(names) - {"manifest.json"}
    for n, values in manifest["files"].items():
        assert hashlib.sha256(member[n]).hexdigest() == values["sha256"] and len(member[n]) == values["byte_size"]
    rows = [json.loads(line) for line in member["conversation.canjsonl"].splitlines()]
    of = lambda kind: [r for r in rows if r["record_type"] == kind]
    assert [r["seq"] for r in of("message")] == [1, 2, 3, 4]
    assert [r["comment_markdown"] for r in of("annotation")] == [m["my-annotation"]]
    assert [r["content_markdown"] for r in of("notebook")] == [m["my-notebook"]]
    assert m["my-annotation"].encode() in member["annotations.md"]
    assert all(m[k].encode() not in value for k in ("other-annotation", "other-notebook", "conflict-draft") for value in member.values())
    attachments = of("attachment")
    assert len(attachments) == 2 and {r["object"]["sha256"] for r in attachments} == {csv_sha, png_sha}
    assert {r["attachment_id"] for r in of("attachment_ref")} == {r["id"] for r in attachments}
    expected_objects = {f"assets/objects/{h[:2]}/{h}" for h in (csv_sha, png_sha)} if policy == "include" else set()
    assert set(names) == {"manifest.json", "conversation.canjsonl", "annotations.md"} | expected_objects
    return {"attachments": policy, "binary_members": len(expected_objects), "metadata_records": len(attachments),
            "own_annotations": 1, "own_notebooks": 1, "foreign_or_conflict_markers": 0}


if __name__ == "__main__":
    action, *args = sys.argv[1:]
    assert action in ("seed", "check")
    print(json.dumps((seed if action == "seed" else check)(*args)))
