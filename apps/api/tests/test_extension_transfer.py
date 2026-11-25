"""No private source data: real auth, staged chunks, existing analysis/commit and original-byte checks."""
import hashlib
import io
import uuid

import pytest

from app.core import auth_middleware
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.extension_transfer import CHUNK_BYTES
from test_reader_extension import paired, package, ROWS, EXT, drive_analysis, commit  # noqa: F401
from test_auth import auth_client, owner_login  # noqa: F401


def transfer(c, h, data, *, key=None):
    key = key or str(uuid.uuid4())
    binding = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    path = EXT + "/transfers/" + key
    response = c.post(path, headers=h, json=binding)
    assert response.status_code == 200, response.text
    return key, path, binding, response.json()


def send_chunk(c, h, path, data, offset, *, digest=None):
    part = data[offset:offset + CHUNK_BYTES]
    return c.post(path + "/chunks", headers=h, data={"offset": str(offset), "sha256": digest or hashlib.sha256(part).hexdigest()},
                  files={"chunk": ("chunk", io.BytesIO(part), "application/octet-stream")})


def test_resumable_transfer_keeps_receipts_checks_digest_and_commits_one_long_message(paired):
    c, h, _ = paired
    body = ("synthetic paragraph of tidal observations\n\n" * 65000) + "[report](assets/report.csv)"
    rows = [ROWS[0], ("assistant", body)]
    data = package(rows)
    assert len(body.encode()) > 2 * 1024**2
    key, path, binding, state = transfer(c, h, data)
    assert state["offset"] == 0
    bad = send_chunk(c, h, path, data, 0, digest="0" * 64)
    assert bad.status_code == 422
    assert c.post(path, headers=h, json=binding).json()["offset"] == 0
    assert c.post(path, headers=h, json={**binding, "sha256": "1" * 64}).status_code == 409
    assert c.post(path + "/finish", headers=h).status_code == 409
    while state["offset"] < len(data):
        r = send_chunk(c, h, path, data, state["offset"])
        assert r.status_code == 200, r.text
        state = r.json()
        # Lost response: querying the exact binding returns the committed offset.
        assert c.post(path, headers=h, json=binding).json() == state
    assert send_chunk(c, h, path, data, 0).status_code == 409
    done = c.post(path + "/finish", headers=h)
    assert done.status_code == 200, done.text
    iid = done.json()["id"]
    assert c.post(path + "/finish", headers=h).json()["id"] == iid
    assert c.get(EXT + "/requests/" + key, headers=h).json()["id"] == iid
    drive_analysis()
    review = c.get(EXT + "/imports/" + iid, headers=h).json()
    assert review["review"], review
    cid = commit(c, h, iid, review["review"])
    assert c.post(path, headers=h, json=binding).json()["id"] == iid
    with auth_middleware.SessionLocal() as db:
        assert db.query(Conversation).count() == 1
        versions = db.query(MessageVersion).join(Message, Message.current_version_id == MessageVersion.id).filter(
            Message.conversation_id == uuid.UUID(cid)).order_by(Message.order_key).all()
        assert len(versions) == 2
        assert versions[-1].display_text.startswith(body.split("[report]")[0])


def test_transfer_is_device_scoped_cancelled_and_does_not_queue_partial_input(paired):
    c, h, grant = paired
    from app.models.background_job import BackgroundJob
    data = package(ROWS)
    _, path, binding, _ = transfer(c, h, data)
    other = c.post(EXT + "/transfers/" + str(uuid.uuid4()), headers=h, json=binding)
    assert other.status_code == 409
    assert c.delete(path, headers=h).status_code == 204
    assert c.delete(path, headers=h).status_code == 204  # A lost cancellation response is idempotent.
    assert c.post(path, headers=h, json=binding).status_code == 409
    with auth_middleware.SessionLocal() as db:
        assert db.query(BackgroundJob).filter_by(job_type="adaptive_import_analysis").count() == 0
    _, next_path, _, _ = transfer(c, h, data)
    assert c.post(next_path + "/finish", headers=h).status_code == 409
    assert c.delete("/api/extension-devices/" + grant["device_id"]).status_code == 204
    assert send_chunk(c, h, next_path, data, 0).status_code == 401


def test_staged_chunks_recover_only_unacknowledged_suffix_and_recheck_binding(paired):
    from app.models.import_record import ImportRecord
    from app.services import extension_transfer as tx
    from app.services.adaptive_import.contracts import AdaptiveImportError
    from app.services.adaptive_import.service import queue_session_analysis
    c, h, grant = paired
    data = bytes(range(256)) * (CHUNK_BYTES // 256 + 1)
    key, path, binding, _ = transfer(c, h, data)
    identity = tx._identity(grant["device_id"], key)
    with auth_middleware.SessionLocal() as db:
        record = db.get(ImportRecord, identity)
        with pytest.raises(AdaptiveImportError, match="Finish the staged upload"):
            queue_session_analysis(db, record)
        part = tx._part(record)
        part.parent.mkdir(parents=True, exist_ok=True)
        part.write_bytes(b"unacknowledged bytes from an interrupted request")
    ack = send_chunk(c, h, path, data, 0)
    assert ack.status_code == 200 and ack.json()["offset"] == CHUNK_BYTES
    with part.open("ab") as target:
        target.write(b"another unacknowledged suffix")
    ack = send_chunk(c, h, path, data, CHUNK_BYTES)
    assert ack.status_code == 200 and ack.json()["offset"] == len(data)
    assert part.read_bytes() == data
    # Filesystem corruption is not excused by the per-chunk receipts.
    with part.open("r+b") as target:
        target.write(b"bad")
    assert c.post(path + "/finish", headers=h).status_code == 422
    assert c.get(EXT + "/requests/" + key, headers=h).json() == {"id": None}
    assert c.delete(path, headers=h).status_code == 204
    assert not part.exists()
    assert c.post(path, headers=h, json=binding).status_code == 409


def test_transfer_permissions_policy_destination_and_old_receipt_are_not_bypassed(paired, monkeypatch):
    from app.core.config import get_settings
    from app.models.administration import InstanceFeaturePolicy
    from app.models.import_record import ImportRecord
    from app.services import extension_transfer as tx
    c, h, grant = paired
    data = package(ROWS)
    binding = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    path = EXT + "/transfers/" + str(uuid.uuid4())
    # A logged-in Web cookie is not an extension bearer; arbitrary origins cannot use a bearer.
    assert c.post(path, json=binding).status_code == 403  # Web Origin is not a registered extension.
    assert c.post(path, headers={"Origin": h["Origin"]}, json=binding).status_code == 401
    assert c.post(path, headers={**h, "Origin": "https://chatgpt.com"}, json=binding).status_code == 403
    assert c.post(path, headers=h, json={**binding, "project": str(uuid.uuid4())}).status_code == 409
    key, path, binding, _ = transfer(c, h, data)
    with auth_middleware.SessionLocal() as db:
        db.get(InstanceFeaturePolicy, 1).allow_user_import = False
        db.commit()
    assert send_chunk(c, h, path, data, 0).status_code == 403
    with auth_middleware.SessionLocal() as db:
        db.get(InstanceFeaturePolicy, 1).allow_user_import = True
        record = db.get(ImportRecord, tx._identity(grant["device_id"], key))
        record.analysis_summary = {**record.analysis_summary, "target_project_id": str(uuid.uuid4())}
        db.commit()
    assert send_chunk(c, h, path, data, 0).status_code == 200
    assert c.post(path + "/finish", headers=h).status_code == 409
    assert c.delete(path, headers=h).status_code == 204
    old = str(uuid.uuid4())
    accepted = c.post(EXT + "/imports", headers={**h, "Idempotency-Key": old},
                      files={"files": ("reader.zip", data, "application/zip")})
    assert accepted.status_code == 201
    assert c.post(EXT + "/transfers/" + old, headers=h, json=binding).status_code == 409
    monkeypatch.setenv("MAX_IMPORT_FILE_SIZE_MB", "1")
    get_settings.cache_clear()
    over = c.post(EXT + "/transfers/" + str(uuid.uuid4()), headers=h,
                  json={**binding, "size": 1024**2 + 1})
    assert over.status_code == 413 and over.json()["detail"]["code"] == "FILE_TOO_LARGE"
