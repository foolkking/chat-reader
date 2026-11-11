"""Initial multipart admission identity; never a retry of analysis or commit."""
import hashlib
import json
import uuid

from sqlalchemy import text

from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.services.adaptive_import.bounded_io import release_file_cache
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.adaptive_import.ordering import ordered_artifacts
from app.services.uploads import UploadLimitError


def request_key(request_id: uuid.UUID) -> str:
    return f"adaptive-upload:{request_id}"


def lock_upload_request(db, scope, request_id):
    """A second upload does not wait behind disk IO or the first COMMIT."""
    if db.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(
            f"adaptive-upload:{scope.owner_user_id}:{request_id}".encode()
        ).digest()[:8], "big", signed=True)
        if not db.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": key}):
            raise AdaptiveImportError("IMPORT_UPLOAD_REQUEST_PENDING",
                "The original upload is still being accepted. Check its receipt before retrying.", layer="file")


def find_upload_request(db, scope, request_id):
    return db.query(BackgroundJob).filter(
        BackgroundJob.owner_user_id == scope.owner_user_id,
        BackgroundJob.job_type == "adaptive_import_analysis",
        BackgroundJob.idempotency_key == request_key(request_id),
    ).order_by(BackgroundJob.created_at, BackgroundJob.id).first()


def request_import(db, scope, job, *, identity_only=False):
    try:
        import_id = uuid.UUID(str((job.payload or {}).get("import_id")))
    except (TypeError, ValueError):
        import_id = None
    record = db.query(ImportRecord.id if identity_only else ImportRecord).filter(
        ImportRecord.id == import_id, ImportRecord.owner_user_id == scope.owner_user_id,
    ).one_or_none() if import_id else None
    if record is None:
        raise AdaptiveImportError("IMPORT_UPLOAD_RECEIPT_UNAVAILABLE",
            "This upload was received, but its import is no longer available. Check Tasks; do not resend it.", layer="file")
    return record


def _binding(descriptors, repair_profile_id, target_project_id):
    return hashlib.sha256(json.dumps({
        "files": descriptors,
        "repair_profile_id": str(repair_profile_id) if repair_profile_id else None,
        "target_project_id": str(target_project_id) if target_project_id else None,
    }, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def staged_binding(record, repair_profile_id, target_project_id):
    # New metadata already contains server-computed hashes: no second disk
    # pass over a 512 MiB batch on the first submission.
    return _binding([[item.filename, item.byte_size, item.sha256] for item in ordered_artifacts(record)],
                    repair_profile_id, target_project_id)


def verify_repeated_upload(job, files, repair_profile_id, target_project_id, *, max_file_bytes, total_limit):
    # Only an explicit repeat hashes already-spooled incoming bytes. No parser,
    # new directory, original-file read, or client-provided missing/hash flag.
    descriptors, total = [], 0
    for upload in files:
        upload.file.seek(0)
        digest, size = hashlib.sha256(), 0
        while chunk := upload.file.read(64 * 1024):
            size += len(chunk)
            total += len(chunk)
            if size > max_file_bytes or total > total_limit:
                raise UploadLimitError("IMPORT_TOTAL_SIZE_LIMIT", "The upload exceeds the configured limit.", status_code=413)
            digest.update(chunk)
            if size % (4 * 1024**2) < len(chunk):
                release_file_cache(upload.file)
        descriptors.append([upload.filename or "upload", size, digest.hexdigest()])
    expected = (job.payload or {}).get("upload_binding")
    if not expected or expected != _binding(descriptors, repair_profile_id, target_project_id):
        raise AdaptiveImportError("IMPORT_UPLOAD_REQUEST_CONFLICT",
            "This upload request belongs to different files, order, or options. Check the original import.", layer="file")
