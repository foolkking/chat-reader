"""Real authorization, analysis spool, worker commit and target receipts. All content synthetic."""
import io
import json
import uuid
import zipfile

import pytest

from sqlalchemy import select

from app.core import auth_middleware
from app.models.attachment import MessageVersionAttachment
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.import_queue import claim_next_import, process_import
from test_reader_extension import EXT, ROWS, auth_client, drive_analysis, package, paired  # noqa: F401


def target(c):
    r = c.post("/api/conversations", json={"title": "Append fixture", "messages": [
        {"role": "user", "content_markdown": "First question"}, {"role": "assistant", "content_markdown": "Original end"}]})
    assert r.status_code == 201
    return r.json()["conversation"]["id"]


def stage(c, cid, rows, *, device=None, partial=False, plain=None):
    route = EXT + "/append-imports" if device else f"/api/conversations/{cid}/append-imports"
    payload = ("source.md", plain, "text/markdown") if plain else ("source.zip", package(rows, partial=partial), "application/zip")
    r = c.post(route, files={"files": payload}, headers={**(device or {}), "Idempotency-Key": str(uuid.uuid4())})
    assert r.status_code == 201, r.status_code
    iid = r.json()["id"]
    drive_analysis()
    s = c.get("/api/append-imports/"+iid).json()
    assert s["state"] == "READY", (s.get("state"), s.get("error"))
    return iid, {"target": cid, "edition": s["edition"], "volume": 0}


def endpoint(i, op):
    return f"/api/append-imports/{i}/{op}"


def review(c, iid, body):
    r = c.post(endpoint(iid, "review"), json=body)
    assert r.status_code == 200, r.status_code
    return r.json()


def run(iid):
    with auth_middleware.SessionLocal() as db:
        assert claim_next_import(db) == uuid.UUID(iid)
        db.commit()
    process_import(uuid.UUID(iid), session_factory=auth_middleware.SessionLocal)


def contents(cid):
    with auth_middleware.SessionLocal() as db:
        return list(db.execute(select(Message.id, Message.order_key, Message.current_version_id,
            MessageVersion.display_text, Message.author_label).join(MessageVersion, Message.current_version_id == MessageVersion.id)
            .where(Message.conversation_id == uuid.UUID(cid)).order_by(Message.order_key)))


def test_sparse_order_originals_and_attachment_isolation(paired):
    c, _, _grant = paired
    cid = target(c)
    original = contents(cid)
    rows = ROWS + [("user", "Fourth source item"), ("assistant", "Fifth source item")]
    for indexes, expected, skip in [([4, 0], 2, 0), ([1, 4], 1, 1), ([0, 1, 4], 0, 3)]:
        i, fields = stage(c, cid, rows)
        body = {**fields, "indexes": indexes}
        r = review(c, i, body)
        assert (r["add"], r["skip"], r["partial"]) == (expected, skip, False)
        assert c.post(f"/api/imports/{i}/commit", json={}).status_code == 409
        approved = {**body, "receipt": r["receipt"]}
        assert c.post(endpoint(i, "confirm"), json=approved).status_code == 202
        assert c.post(endpoint(i, "confirm"), json=approved).status_code == 202
        run(i)
        done = c.post(endpoint(i, "confirm"), json=approved)
        assert done.status_code == 200 and done.json()["result"]["added"] == expected, done.json().get("status")
        with auth_middleware.SessionLocal() as db:
            count = db.query(MessageVersionAttachment).count()
            assert count == (0 if expected == 2 else 1)
    after = contents(cid)
    assert after[:2] == original
    assert after[2][3] == rows[0][1] and after[3][3] == rows[4][1] and "report" in after[4][3]
    assert after[3][4] == "reader:standalone-answer" and after[4][4] is None
    # An answer whose real question was omitted gets its own turn, not the prior prompt.
    # A later, genuinely related answer remains after it and cannot fold into it.
    for index, expected in [(2, [2]), (3, [3]), (4, [4])]:
        turn = c.get(f"/api/conversations/{cid}/reader-turn", params={"anchor_message_id": str(after[index][0])})
        assert turn.status_code == 200
        result = turn.json()
        assert [item["id"] for item in result["items"]] == [str(after[j][0]) for j in expected]
        assert result["items"][0]["standalone_answer"] == (index == 3)
        if index > 2:
            assert result["previous_anchor_message_id"] == str(after[index-1][0])
        if index < 4:
            assert result["next_anchor_message_id"] == str(after[index+1][0])


def test_excerpt_question_is_optional_and_cannot_reference_an_unselected_or_older_question(paired):
    from app.services.adaptive_import.reader_package import messages, package_header, INDEX
    from app.services.adaptive_import.contracts import AdaptiveImportError
    c, grant, _ = paired
    cid = target(c)
    with zipfile.ZipFile(io.BytesIO(package(ROWS))) as z:
        files = {k: z.read(k) for k in z.namelist()}
    metadata = json.loads(files["manifest.json"])
    metadata["lineage"] = "list"
    files["manifest.json"] = json.dumps(metadata).encode()
    def sparse(question, at=1):
        rows = [json.loads(s) for s in files[INDEX].splitlines()]
        for row in rows:
            row.update(parent=None, source_path=[])
        rows[at]["question"] = question
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as z:
            for name, content in files.items():
                z.writestr(name, "".join(json.dumps(r)+"\n" for r in rows) if name == INDEX else content)
        return out.getvalue()
    for when, invalid in [(1,"not-disclosed"),(0,"synthetic-0"),(1,"synthetic-2"),(1,None)]:
        with zipfile.ZipFile(io.BytesIO(sparse(invalid, when))) as z, pytest.raises(AdaptiveImportError):
            list(messages(z, package_header(z)))
    response = c.post(EXT+"/append-imports", headers={**grant, "Idempotency-Key": str(uuid.uuid4())},
                      files={"files": ("chosen.zip", sparse("synthetic-0"), "application/zip")})
    assert response.status_code == 201
    iid = response.json()["id"]
    drive_analysis()
    meta = c.get("/api/append-imports/"+iid).json()
    fields = {"target": cid, "edition": meta["edition"], "volume": 0, "indexes": [1, 0]}
    consent = review(c, iid, fields)
    assert consent["add"] == 2
    assert c.post(endpoint(iid,"confirm"),json={**fields,"receipt":consent["receipt"]}).status_code == 202
    run(iid)
    saved = contents(cid)
    assert len(saved) == 4 and saved[-1][4] is None
    turn = c.get(f"/api/conversations/{cid}/reader-turn", params={"anchor_message_id": str(saved[-1][0])}).json()
    assert [item["id"] for item in turn["items"]] == [str(r[0]) for r in saved[-2:]]


def test_conflict_after_review_and_after_queue_preserves_source_and_requires_new_click(paired):
    c, h, _ = paired
    cid = target(c)
    a, x = stage(c, cid, ROWS, device=h)
    b, y = stage(c, cid, ROWS)
    x, y = {**x, "indexes": [0]}, {**y, "indexes": [2]}
    first, stale = review(c, a, x), review(c, b, y)
    assert first["tail"]["text"] == stale["tail"]["text"] == "Original end"
    assert c.post(endpoint(b, "review"), json={**y, "target": target(c)}).status_code == 404
    assert c.post(endpoint(a, "confirm"), json={**x, "receipt": first["receipt"]}).status_code == 202
    run(a)
    response = c.post(endpoint(b, "confirm"), json={**y, "receipt": stale["receipt"]})
    assert response.status_code == 409
    updated = response.json()["detail"]["review"]
    assert updated["tail"]["text"] == ROWS[0][1] and updated["receipt"] != stale["receipt"]
    assert len(contents(cid)) == 3
    d, z = stage(c, cid, ROWS)
    z = {**z, "indexes": [1]}
    waiting = review(c, d, z)
    assert c.post(endpoint(b, "confirm"), json={**y, "receipt": updated["receipt"]}).status_code == 202
    assert c.post(endpoint(d, "confirm"), json={**z, "receipt": waiting["receipt"]}).status_code == 202
    # A reloaded page has no component state. Restore only the submitted
    # source, target and checkboxes, never old consent to a changed tail/share.
    assert c.get("/api/append-imports/"+d).json().get("submitted_selection") == z
    run(b)
    run(d)
    assert len(contents(cid)) == 4
    failed = c.get("/api/append-imports/"+d).json()
    assert failed["status"] == "failed" and failed["submitted_selection"] == z
    latest = review(c, d, z)
    assert latest["tail"]["text"] == ROWS[2][1]
    assert c.post(endpoint(d, "confirm"), json={**z, "receipt": latest["receipt"]}).status_code == 202
    run(d)
    assert len(contents(cid)) == 5
    assert c.get("/api/append-imports/"+d).json()["submitted_selection"] is None


def test_excerpt_device_cannot_confirm_and_revocation_after_queue_preserves_originals(paired):
    from test_reader_extension import owner_login
    c, grant, device = paired
    cid = target(c)
    original = contents(cid)
    i, fields = stage(c, cid, ROWS, device=grant)
    data = {**fields, "indexes": [1]}
    r = review(c, i, data)
    approved = {**data, "receipt": r["receipt"]}
    assert c.post(f"{EXT}/imports/{i}/commit", headers=grant, json={"receipt": r["receipt"]}).status_code == 409
    c.cookies.clear()
    assert c.post(endpoint(i, "confirm"), headers=grant, json=approved).status_code in {401,403}
    assert c.get("/api/append-imports/"+i).status_code == 401
    assert owner_login(c).status_code == 200
    assert c.post(endpoint(i, "confirm"), json=approved).status_code == 202
    assert c.delete("/api/extension-devices/"+device["device_id"]).status_code == 204
    run(i)
    assert contents(cid) == original
    assert c.get("/api/append-imports/"+i).status_code in {401,403}


def test_manual_insert_rechecks_a_preloaded_destination_after_the_append_worker_commits(paired):
    from app.models.conversation import Conversation
    from app.services.editing.message_edit_service import MessageEditError, insert_manual_messages
    c, _, _ = paired
    cid = target(c)
    original = contents(cid)
    iid, fields = stage(c, cid, ROWS)
    chosen = {**fields, "indexes": [0]}
    receipt = review(c, iid, chosen)["receipt"]
    assert c.post(endpoint(iid, "confirm"), json={**chosen, "receipt": receipt}).status_code == 202
    with auth_middleware.SessionLocal() as other:
        # The ordinary edit route first reads this row to check ownership.
        stale = other.get(Conversation, uuid.UUID(cid))
        revision = stale.offline_revision
        run(iid)
        assert stale.offline_revision == revision
        with pytest.raises(MessageEditError) as refused:
            insert_manual_messages(other, conversation_id=stale.id, anchor_message_id=original[-1][0],
                position="after", mode="single", messages=[("user", "Should not be inserted")],
                expected_offline_revision=revision)
        assert refused.value.status_code == 409
        other.rollback()
    after = contents(cid)
    assert after[:-1] == original and after[-1][3] == ROWS[0][1]


def test_share_added_after_preview_requires_fresh_consent_and_missing_content_is_not_full_success(paired):
    import secrets
    from app.models.share import Share
    c, _, _ = paired
    cid = target(c)
    i, fields = stage(c, cid, ROWS, partial=True)
    body = {**fields, "indexes": [1]}
    first = review(c, i, body)
    assert first["partial"] and not first["live_share"]
    with auth_middleware.SessionLocal() as db:
        db.add(Share(conversation_id=uuid.UUID(cid),scope="conversation",content_mode="live",
                     token_hash=secrets.token_hex(32),token_prefix="synthetic")); db.commit()
    updated = c.post(endpoint(i,"confirm"),json={**body,"receipt":first["receipt"],"allow_partial":True})
    assert updated.status_code == 409
    second = updated.json()["detail"]["review"]
    assert second["live_share"] and second["partial"] and first["receipt"] != second["receipt"]
    for gate in ("allow_share","allow_partial"):
        assert c.post(endpoint(i,"confirm"),json={**body,"receipt":second["receipt"],gate:True}).status_code == 409
    assert len(contents(cid)) == 2
    assert c.post(endpoint(i,"confirm"),json={**body,"receipt":second["receipt"],"allow_partial":True,"allow_share":True}).status_code == 202
    run(i)
    result = c.get("/api/append-imports/"+i).json()["result"]
    assert result["partial"] and result["added"] == 1 and len(contents(cid)) == 3
