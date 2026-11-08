"""Reuse the existing owned analysis job for potentially expensive ZIP edits."""
import uuid
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.services.adaptive_import.contracts import AdaptiveImportError


def queue_operation(db, record, operation, arguments=None):
    from app.services.adaptive_import.service import (
        RECOVERABLE_SESSION_STATES, _require_session_state, queue_session_analysis, session_payload,
    )
    try:
        _require_session_state(record, RECOVERABLE_SESSION_STATES)
    except AdaptiveImportError as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code, "message": str(exc)}) from exc
    previous = record.session_state
    job = queue_session_analysis(db, record)
    job.payload = {**job.payload, "operation": operation, "arguments": arguments or {},
                   "previous_state": previous, "source_fingerprint": record.source_fingerprint}
    db.commit()
    db.refresh(record)
    return JSONResponse(jsonable_encoder({**session_payload(record), "operation_task_id": str(job.id)}), status_code=202)


def prospective_record(record, payload):
    """Admission sees replacement bytes, never the old ZIP's qualification."""
    if payload.get("operation") != "replace":
        return record
    arguments = payload["arguments"]
    replacement = arguments["stored"]
    originals = [item for item in record.artifacts
                 if item.source_type != "adaptive_archive_document" and str(item.id) != arguments["artifact_id"]]
    source_type = "adaptive_archive" if Path(arguments["filename"]).suffix.casefold() == ".zip" else "adaptive_source"
    source = SimpleNamespace(source_type=source_type, byte_size=replacement["byte_size"],
                             safe_filename=replacement["safe_filename"])
    return SimpleNamespace(id=record.id, artifacts=[*originals, source], draft_summary={})


@contextmanager
def operation_admission(db, record, payload):
    from app.services.adaptive_import.memory_budget import import_analysis_admission
    candidate = prospective_record(record, payload)
    with import_analysis_admission(db, candidate, stage="analysis", force_memory_check=True,
                                   sizes=[max(0, int(item.byte_size or 0)) for item in candidate.artifacts]):
        yield


def execute_operation(db, record, payload):
    from app.services.adaptive_import import service
    from app.services.adaptive_import.archive_sources import archive_file_recovery
    from app.services.storage.local_storage import StoredFile
    from app.services.adaptive_import.bounded_io import file_hash
    operation = payload["operation"]
    arguments = payload.get("arguments") or {}
    if record.source_fingerprint != payload.get("source_fingerprint"):
        raise AdaptiveImportError("ANALYSIS_CHANGED", "Source changed; refresh the import session.", layer="analysis")
    record.session_state = payload["previous_state"]
    family = next((item for item in record.structure_families if str(item.id) == arguments.get("family_id")), None)
    artifact = next((item for item in record.artifacts if str(item.id) == arguments.get("artifact_id")), None)
    with archive_file_recovery(record):
        if operation == "replace":
            if artifact is None:
                raise AdaptiveImportError("SOURCE_MISSING", "Source artifact is unavailable.", layer="file")
            stored = StoredFile(**arguments["stored"])
            path = (service._session_root(record.id) / stored.safe_filename).resolve()
            if path.parent != service._session_root(record.id) or file_hash(path) != arguments["sha256"]:
                raise AdaptiveImportError("SOURCE_MISSING", "Replacement source is unavailable.", layer="file")
            # The worker admitted the prospective source set, not the old ZIP.
            service.replace_session_artifact(db, record, artifact, filename=arguments["filename"],
                                             stored_source=(stored, arguments["sha256"]))
        elif operation == "classification":
            if artifact is None:
                raise AdaptiveImportError("SOURCE_MISSING", "Source artifact is unavailable.", layer="file")
            service.reclassify_archive(db, record, artifact,
                                      expected_version=arguments["expected_version"], changes=arguments["changes"])
        elif operation == "groups":
            service.resolve_grouping(db, record, arguments["groups"])
        elif operation == "exclude":
            group = next((item for item in record.input_groups if str(item.id) == arguments["group_id"]), None)
            if group is None:
                raise AdaptiveImportError("SOURCE_MISSING", "Source group is unavailable.", layer="grouping")
            service.remove_input_group(db, record, group)
        elif operation == "reanalyze":
            service.reanalyze_session(db, record)
        else:
            if family is None:
                raise AdaptiveImportError("PROFILE_NOT_FOUND", "The import family is unavailable.", layer="profile")
            if operation == "mapping":
                service.verify_family_mapping(db, record, family, mapping_spec=arguments["mapping_spec"],
                                              profile_name=arguments["profile_name"])
            elif operation == "profile":
                service.select_profile_revision(db, record, family, uuid.UUID(arguments["revision_id"]))
            elif operation == "health":
                result = service.check_family_health(db, record, family)
                _restore_read_state(record)
                return result
            elif operation == "preview":
                result = service.preview_family_mapping(
                    record, family, mapping_spec=arguments["mapping_spec"], profile_name=arguments["profile_name"],
                    sample_group_id=uuid.UUID(arguments["sample_group_id"]) if arguments.get("sample_group_id") else None)
                _restore_read_state(record)
                return result
            else:
                raise ValueError("Unknown import operation.")
    return None


def _restore_read_state(record):
    record.status = "previewed" if record.session_state == "READY" else "resolving"
    record.phase = "ready" if record.session_state == "READY" else "profile_resolution"
