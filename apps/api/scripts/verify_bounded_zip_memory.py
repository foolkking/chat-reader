"""Disk-generated synthetic sources; never load a 100/500 MiB ZIP into RAM."""
import argparse
import hashlib
import json
import os
import uuid
import zipfile
from pathlib import Path

MIB = 1024**2
STATE = Path("/data/bounded-zip-gate.json")
CASES = {"small", "assets100", "assets500", "long"}


def synthetic_zip(path, case):
    from app.services.adaptive_import.bounded_io import release_file_cache
    assets = {}
    if case == "small":
        from scripts.verify_small_zip_memory import synthetic_zip as small_zip
        path.write_bytes(small_zip())
        with path.open("rb") as source:
            release_file_cache(source, written=True)
        return {"messages": 4, "attachments": 14, "references": 13}
    count = 36
    paths = [f"assets/synthetic-{index}.bin" for index in range(4)] if case != "long" else []
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        with archive.open("conversation.md", "w") as body:
            body.write(b"# Synthetic bounded import\n\n")
            for index in range(count):
                body.write(f"## {'User' if index % 2 == 0 else 'Assistant'}\n\n".encode())
                for paragraph in range(180 if case != "long" else 600):
                    body.write(f"Synthetic {index}-{paragraph}: ".encode() + b"x" * 55 + b"\n\n")
                if index == 1:
                    for name in paths:
                        body.write(f"[Synthetic file]({name})\n\n".encode())
        manifest = {"version": "1", "assets": [{"path": name, "kind": "file"} for name in paths],
                    "messages": [{"id": f"synthetic-{index}"} for index in range(count + 16)]}
        archive.writestr("manifest.json", json.dumps(manifest))
        # Include ZIP/Markdown overhead within the existing 500 MiB per-file
        # cap; no test-only production limits or sensor overrides.
        target = (100 if case == "assets100" else 500) * MIB - 2 * MIB
        for index, name in enumerate(paths):
            remaining = target // len(paths)
            digest = hashlib.sha256()
            chunk = bytes([65 + index]) * (64 * 1024)
            written = 0
            with archive.open(name, "w") as output:
                while remaining:
                    piece = chunk[:min(len(chunk), remaining)]
                    output.write(piece)
                    digest.update(piece)
                    remaining -= len(piece)
                    written += len(piece)
                    if written % MIB == 0:
                        release_file_cache(archive.fp, written=True)
            assets[Path(name).name] = digest.hexdigest()
        release_file_cache(archive.fp, written=True)
    with path.open("rb") as source:
        release_file_cache(source, written=True)
    return {"messages": count, "attachments": len(paths), "references": len(paths), "asset_hashes": assets}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["create-database", "idle", "prepare", "status", "queue-commit", "verify"])
    args = parser.parse_args()
    case = os.environ.get("BOUNDED_IMPORT_CASE", "")
    if (os.environ.get("SMALL_IMPORT_MEMORY_GATE") != "1" or os.environ.get("APP_ENV") != "test"
            or case not in CASES):
        raise SystemExit("Disposable CI only.")
    from app.core.config import get_settings
    settings = get_settings()
    database = f"chat_reader_bounded_{case}"
    if "127.0.0.1" not in settings.database_url or not settings.database_url.endswith("/" + database):
        raise SystemExit("Only the dedicated loopback disposable database is permitted.")
    if args.action == "create-database":
        import psycopg
        from psycopg import sql
        url = settings.database_url.rsplit("/", 1)[0].replace("postgresql+psycopg://", "postgresql://") + "/chat_reader"
        with psycopg.connect(url, autocommit=True) as connection:
            if connection.execute("SELECT 1 FROM pg_database WHERE datname=%s", (database,)).fetchone():
                raise SystemExit("Refusing to reuse an existing gate database.")
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        print('{"created":true}')
        return
    from app.core.database import SessionLocal
    from app.models.background_job import BackgroundJob
    from app.models.import_record import ImportRecord
    from app.models.conversation import Conversation
    from app.models.message import Message
    from app.models.render_block import RenderBlock
    from app.models.message_version import MessageVersion
    from app.models.attachment import Attachment, AssetObject, MessageVersionAttachment
    from app.models.user import User
    from app.models.worker_runtime_state import WorkerRuntimeState
    from app.services.adaptive_import.service import begin_session, add_session_source_stream, queue_session_analysis
    from app.services.import_queue import queue_import
    from app.services.adaptive_import.bounded_io import file_hash
    from app.services.assets.asset_store import get_asset_store
    with SessionLocal() as db:
        if args.action == "idle":
            worker = db.get(WorkerRuntimeState, "primary")
            result = {"idle": worker is not None and worker.state == "idle"}
        elif args.action == "prepare":
            if STATE.exists() or db.query(ImportRecord).count() or db.query(Conversation).count():
                raise SystemExit("Gate database and volume must be empty.")
            path = Path("/data/source.zip")
            expected = synthetic_zip(path, case)
            user = User(display_name="Synthetic bounded gate", role="ADMIN", status="ACTIVE")
            db.add(user)
            db.flush()
            record = begin_session(db, 1, owner_user_id=user.id)
            with path.open("rb") as source:
                add_session_source_stream(db, record, "synthetic.zip", source, max_file_bytes=500 * MIB)
            size = path.stat().st_size
            job = queue_session_analysis(db, record)
            db.commit()
            STATE.write_text(json.dumps({"import_id": str(record.id), "job_id": str(job.id), "expected": expected}))
            path.unlink()
            result = {"queued": True, "archive_bytes": size}
        else:
            state = json.loads(STATE.read_text())
            record = db.get(ImportRecord, uuid.UUID(state["import_id"]))
            job = db.get(BackgroundJob, uuid.UUID(state["job_id"]))
            expected = state["expected"]
            if args.action == "status":
                result = {"analysis": job.status, "import": record.status, "state": record.session_state,
                          "failure_code": ((record.analysis_summary or {}).get("failure") or {}).get("code")}
            elif args.action == "queue-commit":
                if (record.session_state != "READY" or record.draft_summary.get("format_version") != 2
                        or record.draft_summary.get("message_count") != expected["messages"]):
                    raise SystemExit("Bounded analysis did not produce the complete v2 preview.")
                queue_import(record, db)
                db.commit()
                result = {"queued": True}
            else:
                if record.status != "committed":
                    raise SystemExit("Canonical commit did not complete.")
                conversations = db.query(Conversation).filter_by(owner_user_id=record.owner_user_id).all()
                if len(conversations) != 1:
                    raise SystemExit("Conversation count mismatch.")
                conversation_id = conversations[0].id
                messages = db.query(Message).filter_by(conversation_id=conversation_id).count()
                attachments = db.query(Attachment).filter_by(import_id=record.id).all()
                refs = db.query(MessageVersionAttachment).join(Attachment).filter(Attachment.import_id == record.id).count()
                blocks = db.query(RenderBlock).join(MessageVersion).join(Message).filter(Message.conversation_id == conversation_id).count()
                if (messages != expected["messages"] or len(attachments) != expected["attachments"]
                        or refs != expected["references"] or (case != "small" and blocks < 6000)):
                    raise SystemExit("Canonical message/block/resource counts mismatch.")
                for attachment in attachments:
                    asset = db.get(AssetObject, attachment.asset_object_id)
                    digest = file_hash(get_asset_store().resolve_key(asset.storage_key))
                    if digest != asset.sha256 or (case != "small" and digest != expected["asset_hashes"][attachment.original_filename]):
                        raise SystemExit("Asset hash mismatch.")
                result = {"passed": True, "conversation_count": 1, "message_count": messages,
                          "attachment_count": len(attachments), "reference_count": refs,
                          "verified_asset_hashes": len(attachments), "block_count": blocks,
                          "draft_format": 2}
        print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
