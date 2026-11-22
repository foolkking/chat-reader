"""Narrow, owner-only facade. No generic method/URL forwarding."""
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.background_job import BackgroundJob
from app.models.reader_extension import ExtensionDevice
from app.models.user_feature_entry import UserFeatureEntry
from app.services import extension_access as access
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


@router.get("/api/extension-devices")
def devices(request: Request, db: Session = DB):
    auth = getattr(request.state, "auth", None)
    if not auth:
        raise HTTPException(401)
    rows = db.scalars(select(ExtensionDevice).where(ExtensionDevice.user_id == auth.user_id,
        ExtensionDevice.expires_at > datetime.now(timezone.utc), ExtensionDevice.code_hash.is_(None))
        .order_by(ExtensionDevice.created_at.desc())).all()
    return {"enabled": bool(get_settings().reader_extension_ids), "items": [
        {"id": g.id, "created_at": g.created_at, "expires_at": g.expires_at} for g in rows]}


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
            "project_discovery": False, "account_discovery": False}


@api.get("/projects")
def catalog_projects(request: Request, db: Session = DB):
    return [{"id": p.id, "name": p.name, "default": p.is_default}
            for p in projects.get_projects(request, False, "title", "asc", db)]


@api.get("/conversations")
def catalog(request: Request, q: str = Query("", max_length=200), project_id: UUID | None = None,
            scope: Literal["all", "unclassified"] = "all", offset: int = Query(0, ge=0),
            limit: int = Query(40, ge=1, le=80), db: Session = DB):
    if q.strip():
        from app.services.search.search_service import search, SearchServiceError
        from app.models.conversation import Conversation
        from app.models.project import Project
        from app.models.project_conversation import ProjectConversation
        owner = ownership_scope_from_request(request)
        try:
            page = search(db, q, limit=limit, offset=offset, project_id=project_id, grouped=True,
                          terms_mode=True, unclassified_only=scope == "unclassified", ownership_scope=owner)
        except SearchServiceError as exc:
            raise HTTPException(400, "Search unavailable.") from exc
        ids = [r.conversation_id for r in page.items]
        pins = dict(db.execute(select(ProjectConversation.conversation_id, ProjectConversation.is_pinned)
            .join(Conversation, Conversation.id == ProjectConversation.conversation_id)
            .where(owner.predicate(Conversation), ProjectConversation.project_id == project_id,
                   ProjectConversation.conversation_id.in_(ids))).all()) if project_id else dict(db.execute(
            select(Conversation.id, Conversation.is_global_pinned).where(owner.predicate(Conversation), Conversation.id.in_(ids))).all())
        in_project = dict(db.execute(select(ProjectConversation.conversation_id, Project.id).join(Project)
            .where(ProjectConversation.conversation_id.in_(ids), owner.predicate(Project), Project.is_default.is_(False),
                   Project.is_archived.is_(False))).all())
        return {"items": [{"id": row.conversation_id, "title": row.conversation_title, "project_id": in_project.get(row.conversation_id),
                           "pinned": bool(pins.get(row.conversation_id))} for row in page.items],
                "has_more": page.has_more}
    rows = (projects.get_project_conversations(project_id, request, limit + 1, offset, "updated", "desc", db)
            if project_id else conversations.list_conversations(request, limit + 1, offset, None, None, "",
                                    None, False, "active", scope, "updated", "desc", db))
    return {"items": [{"id": c.id, "title": c.display_title or c.title, "project_id": project_id or c.project_id,
                       "pinned": c.project_relation.is_pinned if project_id else c.is_global_pinned}
                      for c in rows[:limit]], "has_more": len(rows) > limit}


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
        context_attachment_policy="include" if value.get("include_attachments", False) else "metadata_only")


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


@router.post("/api/conversations/{cid}/quick-context", status_code=202)
@api.post("/conversations/{cid}/context", status_code=202)
def quick_context(cid: UUID, request: Request, key: UUID = Header(alias="Idempotency-Key"), db: Session = DB):
    subject = subject_key_from_request(request)
    body = preset_options(db, subject, get_or_create_preferences(db, subject).context_quick_preset)
    task = archive_exports.queue_archive_export(cid, request, body, False, False, False, True, str(key), db)
    return {"id": task.job_id, "status": task.status}


@api.get("/exports/{jid}")
def export_status(jid: UUID, request: Request, db: Session = DB):
    job = get_owned(db, BackgroundJob, jid, ownership_scope_from_request(request))
    if not job or job.job_type != "conversation_export" or (job.payload or {}).get("export_format") != "context_package":
        raise HTTPException(404)
    return {"id": job.id, "status": job.status, "artifact_id": (job.result or {}).get("artifact_id")}


@api.post("/artifacts/{aid}/claim")
def claim(aid: UUID, body: archive_exports.ExportUsage, request: Request, db: Session = DB):
    scope = ownership_scope_from_request(request)
    artifact = archive_exports.owned_export(db, aid, scope)
    if artifact.format != archive_exports.CONTEXT_PACKAGE_FORMAT:
        raise HTTPException(404)
    result = archive_exports.reserve_download(aid, body, db, scope)
    return {"claim": UUID(result["download_url"].split("?claim=")[1])}


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
    record = _record(db, request, iid)
    info = inspect(db, record)[0] if record.status == "previewed" and record.session_state == "READY" else None
    from app.models.conversation import Conversation
    saved = get_owned(db, Conversation, record.conversation_id, ownership_scope_from_request(request)) if record.status == "committed" and record.conversation_id else None
    return {"id": iid, "state": record.session_state, "status": record.status, "phase": record.phase,
            "progress": record.progress, "review": info, "wait": public_wait(record.analysis_summary),
            "conversation_id": saved.id if saved and not saved.deleted_at else None,
            "title": saved.display_title if saved and not saved.deleted_at else None}


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
    if record.status not in ("queued","committed","processing"):
        if record.session_state != "READY":
            raise HTTPException(409, "Analysis is not ready.")
        info = inspect(db, record)[0]
        if (info["receipt"] != body.receipt or info["partial"] and not body.accept_partial or
                info["live_share"] and not body.accept_share or info["action"] == "conflict" and not body.separate):
            raise HTTPException(409, "Review the current source and sharing before confirming.")
        record.analysis_summary = {**record.analysis_summary, "extension_decision": {
            **body.model_dump(), "source_proof": info["source_proof"], "approved_action": info["action"],
            "approved_target": str(info["conversation_id"] or "")}}
        db.flush()
    result = commit_import(iid, response, ImportCommitOptions(), db, ownership_scope_from_request(request))
    return {"id": iid, "status": result.status}
