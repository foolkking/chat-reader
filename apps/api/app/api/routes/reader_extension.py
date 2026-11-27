"""Narrow, owner-only facade. No generic method/URL forwarding."""
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.background_job import BackgroundJob
from app.models.reader_extension import ExtensionDevice
from app.models.user_feature_entry import UserFeatureEntry
from app.services import extension_access as access
from app.services import extension_pairing as pairing
from app.services.ownership import ownership_scope_from_request, subject_key_from_request, get_owned
from app.services.preferences import get_or_create_preferences
from app.api.routes import archive_exports, attachments, conversations, projects
from app.schemas.attachment import AttachmentUpdateRequest
from app.schemas.project import ProjectConversationPinUpdate, ConversationPinUpdate
from app.schemas.task import ConversationProjectMoveRequest
from app.schemas.export import ExportRequest

router = APIRouter(tags=["Reader browser extension"])
api = APIRouter(prefix="/api/extension/v1")
DB = Depends(get_db)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Consent(Strict):
    expected_user_id: UUID
    client: str = Field(pattern="^[a-p]{32}$")
    challenge: str = Field(pattern="^[A-Za-z0-9_-]{43}$")
    state: str = Field(pattern="^[A-Za-z0-9_-]{43}$")


@router.post("/api/extension-devices/authorize")
def authorize(body: Consent, request: Request, db: Session = DB):
    auth = getattr(request.state, "auth", None)
    if not auth or auth.user_id != body.expected_user_id:
        raise HTTPException(401)
    code = access.issue_code(db, auth, body.client, body.challenge)
    return {"redirect": f"https://{body.client}.chromiumapp.org/reader?code={code}&state={body.state}"}


class ImportProject(Strict):
    expected_user_id: UUID
    device_id: UUID
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120, pattern=r"^[^\x00]+$")]


@router.post("/api/extension-devices/import-project")
def confirm_import_project(body: ImportProject, request: Request, db: Session = DB):
    """An explicit Web-session confirmation for one paired device and project name."""
    from app.models.project import Project
    from app.services.navigation_order_lock import lock_navigation_order
    from app.services.projects.project_service import create_project, ensure_default_project

    auth = getattr(request.state, "auth", None)
    if not auth or auth.user_id != body.expected_user_id:
        raise HTTPException(403, "Use the Reader account connected to the import.")
    principal = access.lock_authorizing_session(db, auth)
    device = db.scalar(select(ExtensionDevice).where(
        ExtensionDevice.id == body.device_id, ExtensionDevice.user_id == auth.user_id
    ).with_for_update())
    if (not device or not device.refresh_hash or device.credential_version != principal.credential_version
            or not access.alive(device.expires_at, datetime.now(timezone.utc))):
        raise HTTPException(403, "Reconnect the browser in the import center.")
    access.check_client(device.client)
    owner = ownership_scope_from_request(request)
    lock_navigation_order(db.connection(), owner.owner_user_id)
    ensure_default_project(db, owner)
    project = db.scalar(select(Project).where(Project.owner_user_id == auth.user_id, Project.name == body.name))
    if project is None:
        project = create_project(db, name=body.name, description=None, color=None, icon=None, ownership_scope=owner)
    elif project.is_archived or project.is_default:
        raise HTTPException(409, "Project name belongs to an archived or default project.")
    result = {"id": project.id, "client": device.client}
    db.commit()
    return result


@router.get("/api/extension-devices")
def devices(request: Request, db: Session = DB):
    auth = getattr(request.state, "auth", None)
    if not auth:
        raise HTTPException(401)
    rows = db.scalars(select(ExtensionDevice).where(ExtensionDevice.user_id == auth.user_id,
        ExtensionDevice.expires_at > datetime.now(timezone.utc), ExtensionDevice.code_hash.is_(None))
        .order_by(ExtensionDevice.created_at.desc())).all()
    return {"enabled": bool(get_settings().reader_extension_ids), "items": [
        {"id": g.id, "name": g.device_name or "Chat Reader", "created_at": g.created_at, "expires_at": g.expires_at} for g in rows]}


@router.delete("/api/extension-devices/{device_id}", status_code=204)
def revoke(device_id: UUID, request: Request, db: Session = DB):
    auth = getattr(request.state, "auth", None)
    if not auth:
        raise HTTPException(401)
    db.query(ExtensionDevice).filter_by(id=device_id, user_id=auth.user_id).delete()
    db.commit()


class Exchange(Strict):
    client: str = Field(pattern="^[a-p]{32}$")
    code: str | None = Field(None, pattern="^[A-Za-z0-9_-]{43}$")
    verifier: str | None = Field(None, pattern="^[A-Za-z0-9._~-]{43,128}$")
    refresh: str | None = Field(None, pattern="^[A-Za-z0-9_-]{64}$")


class PairStart(Strict):
    client: str = Field(pattern="^[a-p]{32}$")
    device_name: Literal["Chat Reader · Chrome", "Chat Reader · Edge", "Chat Reader · Chromium"]


class PairTicket(Strict):
    client: str = Field(pattern="^[a-p]{32}$")
    device_code: str = Field(pattern="^[A-Za-z0-9_-]{43}$")


class PairCode(Strict):
    code: str = Field(pattern=r"^[A-HJ-NP-Za-hj-np-z2-9]{4}-?[A-HJ-NP-Za-hj-np-z2-9]{4}$")
    expected_user_id: UUID


def pair_client(request, client, db, action, limit):
    access.check_client(client)
    if request.headers.get("origin") != "chrome-extension://" + client:
        raise HTTPException(403)
    pairing.throttle(db, action, request.client.host if request.client else "local", limit)


@api.post("/pair/start")
def pair_start(body: PairStart, request: Request, db: Session = DB):
    pair_client(request, body.client, db, "start", 30)
    return pairing.start(db, body.client, body.device_name)


@api.post("/pair/poll")
def pair_poll(body: PairTicket, request: Request, db: Session = DB):
    pair_client(request, body.client, db, "poll", 2400)
    return pairing.poll(db, body.client, body.device_code)


@api.post("/pair/cancel")
def pair_cancel(body: PairTicket, request: Request, db: Session = DB):
    pair_client(request, body.client, db, "cancel", 120)
    return pairing.poll(db, body.client, body.device_code, cancel=True)


def pair_user(request, body, db):
    auth = getattr(request.state, "auth", None)
    if not auth or not auth.user_id or auth.user_id != body.expected_user_id:
        raise HTTPException(401)
    pairing.throttle(db, "check", str(auth.user_id), 24)
    return auth


@router.post("/api/extension-devices/pair/preview")
def pair_preview(body: PairCode, request: Request, db: Session = DB):
    pair_user(request, body, db)
    row = pairing.by_code(db, body.code)
    return {"device_name": row.device_name, "expires_at": row.expires_at, "scopes": access.SCOPES}


@router.post("/api/extension-devices/pair/approve", status_code=204)
def pair_approve(body: PairCode, request: Request, db: Session = DB):
    pairing.approve(db, pair_user(request, body, db), body.code)


@api.post("/token")
def token(body: Exchange, request: Request, db: Session = DB):
    origin = request.headers.get("origin")
    if origin and origin != "chrome-extension://" + body.client:
        raise HTTPException(403)
    if not ((body.code and body.verifier and not body.refresh) or (body.refresh and not body.code and not body.verifier)):
        raise HTTPException(422, "Invalid grant type.")
    return access.exchange(db, **body.model_dump())


@api.get("/capabilities")
def capabilities(db: Session = DB):
    from app.services.feature_policies import get_feature_policy
    return {"protocol": 1, "import_profile": "reader-chat-v1",
            "capture": get_settings().reader_extension_capture and get_feature_policy(db).allow_user_import,
            "catalog_details": True, "catalog_names": True, "context_settings": True, "save_receipts": True, "source_lookup": True,
            "resumable_capture": True, "import_retry": True, "import_diagnostics": True,
            "selective_append_ranges": True, "web_import_project": True,
            "selective_append": get_settings().reader_extension_capture and get_feature_policy(db).allow_user_import,
            "project_discovery": False, "account_discovery": False}


class SourceStatus(Strict):
    source_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")


@api.post("/sources/status")
def source_status(body: SourceStatus, request: Request, response: Response, db: Session = DB):
    """One user-selected source. Does not read ChatGPT, enumerate sources or attest freshness."""
    from app.models.conversation import Conversation
    from app.models.reader_extension import ExtensionSource
    owner = request.state.auth.user_id
    response.headers["Cache-Control"] = "private, no-store"
    cid = db.scalar(select(Conversation.id).join(ExtensionSource, ExtensionSource.conversation_id == Conversation.id)
                    .where(ExtensionSource.owner_user_id == owner, ExtensionSource.source_key == "chatgpt:" + body.source_id,
                           Conversation.owner_user_id == owner, Conversation.deleted_at.is_(None),
                           Conversation.status == "active"))
    return {"conversation_id": cid}


@api.get("/projects")
def catalog_projects(request: Request, db: Session = DB):
    return [{"id": p.id, "name": p.name, "default": p.is_default}
            for p in projects.get_projects(request, False, "title", "asc", db)]


@api.get("/conversations")
def catalog(request: Request, q: str = Query("", max_length=200), project_id: UUID | None = None,
            scope: Literal["all", "unclassified"] = "all", offset: int = Query(0, ge=0),
            view: Literal["library", "recent", "pinned"] = "library", limit: int = Query(40, ge=1, le=80),
            match: Literal["full", "names"] = "full", db: Session = DB):
    from app.services.extension_catalog import catalog as list_catalog
    return list_catalog(db, ownership_scope_from_request(request), q, project_id, scope, view, offset, limit,
                        names_only=match == "names")


@api.get("/files")
def files(request: Request, q: str = Query("", max_length=200), project_id: UUID | None = None,
          offset: int = Query(0, ge=0), db: Session = DB):
    page = attachments.list_attachment_directory(request, q, None, "all", project_id, 40, offset, db)
    return {"items": [{"id": f.id, "name": f.display_name, "conversation_id": f.conversation_id,
                       "conversation_title": f.conversation_display_title, "mime": f.detected_mime_type or f.declared_mime_type,
                       "bytes": f.asset_object.byte_size if f.asset_object else None} for f in page.items],
            "has_more": page.has_more}


@api.patch("/conversations/{cid}/files/{fid}", status_code=204)
def rename(cid: UUID, fid: UUID, body: AttachmentUpdateRequest, request: Request, db: Session = DB):
    attachments.update_conversation_attachment(cid, fid, body, request, db)


@api.put("/conversations/{cid}/project", status_code=204)
def move(cid: UUID, body: ConversationProjectMoveRequest, request: Request, db: Session = DB):
    conversations.move_conversation_project(cid, body, request, db)


@api.patch("/conversations/{cid}/pin", status_code=204)
def pin(cid: UUID, body: ConversationPinUpdate, request: Request, project_id: UUID | None = None, db: Session = DB):
    if project_id:
        projects.pin_project_conversation(project_id, cid, ProjectConversationPinUpdate(is_pinned=body.is_pinned), request, db)
    else:
        conversations.set_conversation_pin(cid, body, request, db)


def preset_options(db, subject, preset_id):
    value = {}
    if preset_id is not None:
        entry = db.scalar(select(UserFeatureEntry).where(UserFeatureEntry.id == preset_id,
            UserFeatureEntry.subject_key == subject, UserFeatureEntry.collection == "export-preset"))
        if not entry or entry.value.get("format") != "context":
            raise HTTPException(409, "Context preset unavailable. Select a default in Reader.")
        value = entry.value
    return ExportRequest(format="context_package", context_scope="full_conversation",
        continuation_policy="auto" if value.get("include_continuation", True) else "raw_only",
        context_attachment_policy="include" if value.get("include_attachments", preset_id is None) else "metadata_only")


class Preset(Strict):
    preset_id: UUID | None


@router.put("/api/preferences/context-quick-preset")
def set_preset(body: Preset, request: Request, db: Session = DB):
    subject = subject_key_from_request(request)
    preset_options(db, subject, body.preset_id)
    get_or_create_preferences(db, subject).context_quick_preset = body.preset_id
    db.commit()
    return body


@router.get("/api/preferences/context-quick-preset")
def read_preset(request: Request, db: Session = DB):
    return {"preset_id": get_or_create_preferences(db, subject_key_from_request(request)).context_quick_preset}


def context_scope(options):
    return {"attachments": options.context_attachment_policy, "continuation": options.continuation_policy,
            "personal_annotations_and_notebook": True}


@api.get("/context/options")
def context_options(request: Request, db: Session = DB):
    subject = subject_key_from_request(request)
    preset = get_or_create_preferences(db, subject).context_quick_preset
    options = preset_options(db, subject, preset)
    entry = db.get(UserFeatureEntry, preset) if preset else None
    return {**context_scope(options), "preset_id": preset, "revision": entry.revision if entry else 0}


class QuickOptions(Strict):
    preset_id: UUID | None
    revision: int = Field(ge=0)
    include_attachments: bool
    include_continuation: bool


@api.put("/context/options")
def update_options(body: QuickOptions, request: Request, db: Session = DB):
    from app.services.user_feature_entries import write_entry, UserFeatureEntryConflict, lock_feature_collection
    subject = subject_key_from_request(request)
    # The Web preset writer takes collection -> preferences -> account locks.
    # Use that order before reading the pointer/revision, not just before saving.
    lock_feature_collection(db, subject, "export-preset")
    pref = get_or_create_preferences(db, subject)
    if pref.context_quick_preset != body.preset_id:
        raise HTTPException(409, "The quick preset changed.")
    preset_options(db, subject, body.preset_id)
    old = db.get(UserFeatureEntry, body.preset_id) if body.preset_id else None
    value = dict(old.value) if old else {"format": "context", "name": "Chat Reader · AI"}
    value.update(include_attachments=body.include_attachments, include_continuation=body.include_continuation)
    try:
        entry = write_entry(db, subject, "export-preset", body.preset_id or uuid4(), body.revision, value)
    except UserFeatureEntryConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    pref.context_quick_preset = entry.id
    db.commit()
    return context_options(request, db)


@api.get("/context/skill")
def context_skill(request: Request, locale: Literal["zh-CN", "en"] = "en", db: Session = DB):
    from app.api.routes import skills
    selected = skills.resolve_skill(db, category="EXPORT_CONTEXT", locale=locale, subject_key=subject_key_from_request(request))
    db.commit()
    url = selected.get("bundle_url") or ""
    if url == "/skills/context-acquisition.zip":
        return {"builtin": url}
    if selected["source"] == "USER":
        return skills.bundle_download(UUID(selected["id"]), request, selected["bundle_revision"], db)
    import re
    match = re.fullmatch(r"/api/skills/system/([0-9a-f-]{36})/bundle\?revision=\d+", url)
    if not match:
        raise HTTPException(404, "Selected Skill unavailable.")
    return skills.system_bundle_download(UUID(match[1]), selected["bundle_revision"], db)


@router.post("/api/conversations/{cid}/quick-context", status_code=202)
@api.post("/conversations/{cid}/context", status_code=202)
def quick_context(cid: UUID, request: Request, key: UUID = Header(alias="Idempotency-Key"), db: Session = DB):
    subject = subject_key_from_request(request)
    body = preset_options(db, subject, get_or_create_preferences(db, subject).context_quick_preset)
    task = archive_exports.queue_archive_export(cid, request, body, False, False, False, True, str(key), db)
    return {"id": task.job_id, "status": task.status, "context_policy": context_scope(body)}


@api.get("/exports/{jid}")
def export_status(jid: UUID, request: Request, db: Session = DB):
    job = get_owned(db, BackgroundJob, jid, ownership_scope_from_request(request))
    if not job or job.job_type != "conversation_export" or (job.payload or {}).get("export_format") != "context_package":
        raise HTTPException(404)
    result = job.result or {}
    return {"id": job.id, "status": job.status, "artifact_id": result.get("artifact_id"), "delivery": result.get("context_delivery")}


@api.post("/artifacts/{aid}/claim")
def claim(aid: UUID, body: archive_exports.ExportUsage, request: Request, db: Session = DB):
    scope = ownership_scope_from_request(request)
    artifact = archive_exports.owned_export(db, aid, scope)
    if artifact.format != archive_exports.CONTEXT_PACKAGE_FORMAT:
        raise HTTPException(404)
    result = archive_exports.reserve_download(aid, body, db, scope)
    return {"claim": UUID(result["download_url"].split("?claim=")[1]), "filename": artifact.filename}


@api.get("/artifacts/{aid}/download")
def download(aid: UUID, claim: UUID, request: Request, db: Session = DB):
    scope = ownership_scope_from_request(request)
    if archive_exports.owned_export(db, aid, scope).format != archive_exports.CONTEXT_PACKAGE_FORMAT:
        raise HTTPException(404)
    return archive_exports.download_archive(aid, request, claim, db, scope)


@api.delete("/device", status_code=204)
def disconnect(request: Request, db: Session = DB):
    auth = request.state.auth
    db.query(ExtensionDevice).filter_by(id=auth.session_id, user_id=auth.user_id).delete()
    db.commit()


@api.post("/imports", status_code=201)
def upload(request: Request, files: list[UploadFile] = File(...), target_project_id: UUID | None = Form(None),
           key: UUID = Header(alias="Idempotency-Key"), db: Session = DB):
    from app.api.routes.adaptive_imports import stage_import_session
    if not get_settings().reader_extension_capture:
        raise HTTPException(403, "Chat capture is disabled on this Reader.")
    if len(files) != 1 or not (files[0].filename or "").lower().endswith(".zip"):
        raise HTTPException(422, "One Reader ZIP is required.")
    result = stage_import_session(files, None, target_project_id, key, db, ownership_scope_from_request(request),
                                  device=request.state.auth.session_id)
    return {"id": result["import_id"], "state": result["state"]}


class TransferStart(Strict):
    size: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    project: UUID | None = None
    excerpt: bool = False


@api.post("/transfers/{key}")
def transfer_start(key: UUID, body: TransferStart, request: Request, db: Session = DB):
    from app.services import extension_transfer as tx
    return tx.begin(db, ownership_scope_from_request(request), request.state.auth.session_id, key, body.size,
                    body.sha256, body.project, body.excerpt)


@api.post("/transfers/{key}/chunks")
def transfer_chunk(key: UUID, request: Request, offset: int = Form(ge=0), sha256: str = Form(pattern=r"^[a-f0-9]{64}$"),
                   chunk: UploadFile = File(...), db: Session = DB):
    from app.services import extension_transfer as tx
    return tx.chunk(db, ownership_scope_from_request(request), request.state.auth.session_id, key, offset, sha256, chunk)


@api.post("/transfers/{key}/finish")
def transfer_finish(key: UUID, request: Request, db: Session = DB):
    from app.services import extension_transfer as tx
    return tx.finish(db, ownership_scope_from_request(request), request.state.auth.session_id, key)


@api.delete("/transfers/{key}", status_code=204)
def transfer_discard(key: UUID, request: Request, db: Session = DB):
    from app.services import extension_transfer as tx
    tx.discard(tx._record(db, ownership_scope_from_request(request), request.state.auth.session_id, key))
    db.commit()


@api.post("/append-imports", status_code=201)
def upload_excerpt(request: Request, files: list[UploadFile] = File(...),
                   key: UUID = Header(alias="Idempotency-Key"), db: Session = DB):
    from app.api.routes.adaptive_imports import stage_import_session
    if not get_settings().reader_extension_capture:
        raise HTTPException(403)
    if len(files) != 1 or not (files[0].filename or "").lower().endswith(".zip"):
        raise HTTPException(422)
    device = str(request.state.auth.session_id)
    result = stage_import_session(files, None, None, key, db, ownership_scope_from_request(request),
                                 device=device, append_only={"device": device})
    return {"id": result["import_id"], "state": result["state"]}


def _record(db, request, iid, *, lock=False):
    from app.models.import_record import ImportRecord
    stmt = select(ImportRecord).where(ImportRecord.id == iid, ImportRecord.owner_user_id == request.state.auth.user_id)
    record = db.scalar(stmt.with_for_update() if lock else stmt)
    if not record or (record.analysis_summary or {}).get("extension_device") != str(request.state.auth.session_id):
        raise HTTPException(404)
    return record


@api.get("/requests/{key}")
def upload_receipt(key: UUID, request: Request, db: Session = DB):
    from app.services.adaptive_import.upload_receipts import find_upload_request
    job = find_upload_request(db, ownership_scope_from_request(request), key)
    if not job:
        return {"id": None}
    return {"id": _record(db, request, UUID(job.payload["import_id"])).id}


@api.get("/imports/{iid}")
def import_state(iid: UUID, request: Request, db: Session = DB):
    from app.services.extension_import import inspect
    from app.services.adaptive_import.resource_wait import public_wait
    from app.services.extension_results import public_append_status, public_failure, public_result
    record = _record(db, request, iid)
    if (record.analysis_summary or {}).get("append_only"):
        return {"id": iid, "state": record.session_state, "status": record.status, "mode": "selective_append",
                "failure": public_failure(record), **public_append_status(record)}
    info = inspect(db, record)[0] if record.status == "previewed" and record.session_state == "READY" else None
    from app.models.conversation import Conversation
    saved = get_owned(db, Conversation, record.conversation_id, ownership_scope_from_request(request)) if record.status == "committed" and record.conversation_id else None
    return {"id": iid, "state": record.session_state, "status": record.status, "phase": record.phase,
            "progress": record.progress, "review": info, "wait": public_wait(record.analysis_summary),
            "conversation_id": saved.id if saved and not saved.deleted_at else None,
            "title": (saved.display_title or saved.title) if saved and not saved.deleted_at else None,
            "result": public_result(db, record, saved), "failure": public_failure(record)}


@api.post("/imports/{iid}/retry", status_code=202)
def retry_import(iid: UUID, request: Request, db: Session = DB):
    from app.services.extension_retry import retry
    return retry(db, request.state.auth, iid)


class Decision(Strict):
    receipt: str = Field(pattern="^[0-9a-f]{64}$")
    accept_partial: bool = False
    accept_share: bool = False
    separate: bool = False


@api.post("/imports/{iid}/commit", status_code=202)
def confirm(iid: UUID, body: Decision, request: Request, response: Response, db: Session = DB):
    from app.services.extension_import import inspect
    from app.api.routes.imports import commit_import
    from app.schemas.import_schema import ImportCommitOptions
    record = _record(db, request, iid, lock=True)
    if (record.analysis_summary or {}).get("append_only"):
        raise HTTPException(409, "Review the selected messages in Reader.")
    if record.status not in ("queued","committed","processing"):
        if record.session_state != "READY":
            raise HTTPException(409, "Analysis is not ready.")
        info = inspect(db, record)[0]
        if (info["receipt"] != body.receipt or info["partial"] and not body.accept_partial or
                info["live_share"] and not body.accept_share or body.separate != (info["action"] == "conflict")):
            raise HTTPException(409, "Review the current source and sharing before confirming.")
        record.analysis_summary = {**record.analysis_summary, "extension_decision": {
            **body.model_dump(), "source_proof": info["source_proof"], "approved_action": info["action"],
            "approved_target": str(info["conversation_id"] or "")}}
        db.flush()
    result = commit_import(iid, response, ImportCommitOptions(), db, ownership_scope_from_request(request))
    return {"id": iid, "status": result.status}
