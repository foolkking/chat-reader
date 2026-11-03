"""Synthetic-only CI control plane, outside the memory-constrained worker.

Never run against a serving database. The actual analyzer/committer runs in
the unmodified application worker; this helper only queues and verifies work.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import uuid
import zipfile
from pathlib import Path

STATE = Path("/data/small-zip-gate.json")


def synthetic_zip() -> bytes:
    """Match the reported archive shape, without copying user data."""
    assets = [f"assets/picture-{index}.png" for index in range(13)] + ["assets/supplement.md"]
    paragraphs = [f"Synthetic paragraph {index}." for index in range(161)]
    body = "\n\n".join(paragraphs + [f"![Picture {index}]({path})" for index, path in enumerate(assets[:13])])
    transcript = (
        "# Synthetic conversation\n\n## User\nFirst question.\n\n"
        f"## Assistant\n{body}\n\n## User\nFollow-up.\n\n## Assistant\nFinal answer.\n"
    )
    transcript = transcript.replace("Synthetic paragraph 0.", "Synthetic paragraph 0." + "x" * (22587 - len(transcript.encode())), 1)
    manifest = json.dumps({
        "version": "1",
        "assets": [{"path": path} for path in assets],
        "messages": [{"id": f"synthetic-{index}"} for index in range(5)],
    }).encode()
    # A valid one-pixel PNG, with distinct harmless trailing synthetic bytes.
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("assets/", b"")
        archive.writestr("metadata/", b"")
        archive.writestr("conversation.md", transcript.encode())
        archive.writestr("manifest.json", manifest)
        for index, path in enumerate(assets[:13]):
            archive.writestr(path, png + bytes([65 + index]) * (110_000 + index))
        archive.writestr(assets[13], b"# Synthetic supplementary document\n\nNot a second conversation.\n")
    return data.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["idle", "prepare", "status", "queue-commit", "verify"])
    args = parser.parse_args()
    if os.environ.get("SMALL_IMPORT_MEMORY_GATE") != "1" or os.environ.get("APP_ENV") != "test":
        raise SystemExit("This helper is restricted to the disposable synthetic CI gate.")
    from app.core.config import get_settings
    settings = get_settings()
    if "127.0.0.1" not in settings.database_url or not settings.database_url.endswith("/chat_reader"):
        raise SystemExit("Only the disposable loopback CI database is permitted.")
    from app.core.database import SessionLocal
    from app.models.attachment import Attachment, MessageVersionAttachment
    from app.models.background_job import BackgroundJob
    from app.models.conversation import Conversation
    from app.models.import_record import ImportRecord
    from app.models.message import Message
    from app.models.user import User
    from app.models.worker_runtime_state import WorkerRuntimeState
    from app.services.adaptive_import.service import begin_session, add_session_source_stream, queue_session_analysis
    from app.services.import_queue import queue_import

    with SessionLocal() as db:
        if args.action == "idle":
            worker = db.get(WorkerRuntimeState, "primary")
            result = {"idle": worker is not None and worker.state == "idle"}
        elif args.action == "prepare":
            if STATE.exists() or db.query(ImportRecord).count() or db.query(Conversation).count():
                raise SystemExit("The synthetic database/volume must be empty.")
            user = User(display_name="Synthetic memory gate", role="ADMIN", status="ACTIVE")
            db.add(user)
            db.flush()
            record = begin_session(db, 1, owner_user_id=user.id)
            data = synthetic_zip()
            with io.BytesIO(data) as source:
                add_session_source_stream(db, record, "synthetic-memory.zip", source, max_file_bytes=32 * 1024**2)
            job = queue_session_analysis(db, record)
            db.commit()
            STATE.write_text(json.dumps({"import_id": str(record.id), "job_id": str(job.id)}))
            result = {"queued": True, "archive_bytes": len(data), "entries": 18}
        else:
            state = json.loads(STATE.read_text())
            record = db.get(ImportRecord, uuid.UUID(state["import_id"]))
            job = db.get(BackgroundJob, uuid.UUID(state["job_id"]))
            if record is None or job is None:
                raise SystemExit("Synthetic task disappeared.")
            if args.action == "status":
                result = {
                    "analysis": job.status, "state": record.session_state,
                    "import": record.status,
                    "failure_code": (record.analysis_summary or {}).get("failure", {}).get("code"),
                }
            elif args.action == "queue-commit":
                receipt = (record.analysis_summary or {}).get("small_zip_profile") or {}
                expected = {"conversation_count": 1, "message_count": 4, "block_count": 177,
                            "attachment_count": 14, "reference_count": 13}
                if record.session_state != "READY" or any(receipt.get(key) != value for key, value in expected.items()):
                    raise SystemExit("Analysis did not produce the expected bounded receipt.")
                queue_import(record, db)
                db.commit()
                result = {"queued": True, **expected}
            else:
                if record.status != "committed":
                    raise SystemExit("Canonical commit did not complete.")
                conversations = db.query(Conversation).filter_by(owner_user_id=record.owner_user_id).all()
                conversation_ids = [item.id for item in conversations]
                attachments = db.query(Attachment).filter_by(import_id=record.id).all()
                counts = {
                    "conversation_count": len(conversations),
                    "message_count": db.query(Message).filter(Message.conversation_id.in_(conversation_ids)).count(),
                    "attachment_count": len(attachments),
                    "reference_count": db.query(MessageVersionAttachment).join(Attachment).filter(Attachment.import_id == record.id).count(),
                }
                if counts != {"conversation_count": 1, "message_count": 4, "attachment_count": 14, "reference_count": 13}:
                    raise SystemExit("Canonical counts differ from the fixture contract.")
                from app.services.assets.asset_store import get_asset_store
                store = get_asset_store()
                with zipfile.ZipFile(io.BytesIO(synthetic_zip())) as archive:
                    expected_hashes = {
                        Path(info.filename).name: hashlib.sha256(archive.read(info)).hexdigest()
                        for info in archive.infolist()
                        if not info.is_dir() and info.filename.startswith("assets/")
                    }
                verified = 0
                for attachment in attachments:
                    asset = attachment.asset_object
                    if (
                        asset is None or asset.status != "available"
                        or asset.sha256 != expected_hashes.get(attachment.original_filename)
                    ):
                        raise SystemExit("A synthetic attachment is unavailable.")
                    digest = hashlib.sha256()
                    size = 0
                    with store.resolve_key(asset.storage_key).open("rb") as handle:
                        while chunk := handle.read(64 * 1024):
                            digest.update(chunk)
                            size += len(chunk)
                    if digest.hexdigest() != asset.sha256 or size != asset.byte_size:
                        raise SystemExit("Synthetic attachment hash mismatch.")
                    verified += 1
                result = {"passed": True, **counts, "verified_asset_hashes": verified}
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
