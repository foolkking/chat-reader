"""The web session reviews the destination; device grants may only stage an explicitly selected excerpt."""
from uuid import UUID
from typing import Annotated

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.conversation import Conversation
from app.models.import_record import ImportRecord
from app.services.adaptive_import import append_choices as choices
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.import_queue import queue_import
from app.services.extension_results import public_failure
from app.services.ownership import ownership_scope_from_request
from app.services import selective_append as service

class SelectionRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()
        if self.endpoint.__name__ not in {"preview", "confirm"}:
            return handler

        async def bounded(request):
            # Bound actual bytes, including chunked/incorrect Content-Length.
            # Upload staging retains its existing independent upload admission.
            parts, size = [], 0
            async for part in request.stream():
                size += len(part)
                if size > choices.MAX_SELECTION_BYTES:
                    raise HTTPException(413, {"code": "APPEND_SELECTION_TOO_LARGE"})
                parts.append(part)
            request._body = b"".join(parts)
            return await handler(request)
        return bounded


router = APIRouter(tags=["Selective append"], route_class=SelectionRoute)
DB = Depends(get_db)


def owner(request):
    user = getattr(getattr(request.state, "auth", None), "user_id", None)
    if not user:
        raise HTTPException(401)
    return user


def source(db, request, iid, *, lock=False):
    q = select(ImportRecord).where(ImportRecord.id == iid, ImportRecord.owner_user_id == owner(request))
    rec = db.scalar((q.with_for_update() if lock else q).execution_options(populate_existing=True))
    if not rec or not (rec.analysis_summary or {}).get("append_only"):
        raise HTTPException(404)
    service.authorize(db, rec)
    return rec


@router.post("/api/conversations/{cid}/append-imports", status_code=201)
def stage(cid: UUID, request: Request, files: list[UploadFile] = File(...),
          key: UUID = Header(alias="Idempotency-Key"), db: Session = DB):
    from app.api.routes.adaptive_imports import stage_import_session
    if not db.scalar(select(Conversation.id).where(Conversation.id == cid, Conversation.owner_user_id == owner(request),
                    Conversation.status == "active", Conversation.deleted_at.is_(None))):
        raise HTTPException(404)
    result = stage_import_session(files, None, None, key, db, ownership_scope_from_request(request),
                                 append_only={"target": str(cid)})
    return {"id": result["import_id"]}


def metadata(r):
    s = r.analysis_summary or {}
    failure = public_failure(r)
    decision = service.submitted_decision(s)
    # Only the authenticated owner reads this projection. A reopened tab needs
    # the exact staged coordinates, not yesterday's consent to modify the tail.
    submitted = {k: decision[k] for k in ("edition", "target", "volume", "indexes", "ranges", "selected_count") if k in decision} if (
        decision and not s.get("append_result") and decision.get("edition") == r.draft_sha256) else None
    return {"id": str(r.id), "target": s["append_only"].get("target"), "excerpt": bool(s["append_only"].get("device")),
            "edition": r.draft_sha256, "state": r.session_state, "status": r.status, "phase": r.phase,
            "progress": r.progress, "error": failure["code"] if failure else None, "failure": failure,
            "result": s.get("append_result"), "pending_receipt": decision.get("receipt"), "submitted_selection": submitted,
            "selection_capabilities": {"ranges": True, "max_ranges": choices.MAX_RANGES, "legacy_max_indexes": choices.MAX_SELECTION},
            "sources": [{k: b[k] for k in ("ordinal", "title", "count")}
                        for b in (r.draft_summary or {}).get("append_choices", [])]}


@router.get("/api/append-imports/{iid}")
def status(iid: UUID, request: Request, response: Response, db: Session = DB):
    response.headers["Cache-Control"] = "private, no-store"
    return metadata(source(db, request, iid))


@router.get("/api/append-imports/{iid}/targets")
def targets(iid: UUID, request: Request, response: Response, q: str = Query(default="", max_length=200),
            page: int = Query(default=0, ge=0, le=10000), db: Session = DB):
    """Only a device excerpt needs a destination. Fixed imports never offer a target switch."""
    from app.models.project import Project
    from app.models.project_conversation import ProjectConversation
    response.headers["Cache-Control"] = "private, no-store"
    r = source(db, request, iid)
    if r.analysis_summary["append_only"].get("target"):
        raise HTTPException(409, {"code": "APPEND_TARGET_FIXED"})
    query = select(Conversation.id, Conversation.display_title, Project.name, Project.is_default).outerjoin(
        ProjectConversation, ProjectConversation.conversation_id == Conversation.id).outerjoin(
        Project, (Project.id == ProjectConversation.project_id) & (Project.owner_user_id == r.owner_user_id)
    ).where(Conversation.owner_user_id == r.owner_user_id, Conversation.status == "active", Conversation.deleted_at.is_(None))
    if q.strip():
        query = query.where(Conversation.display_title.icontains(q.strip(), autoescape=True))
    found = db.execute(query.order_by(Conversation.updated_at.desc(), Conversation.id).offset(page * 20).limit(21)).all()
    return {"items": [{"id": str(cid), "title": title, "project": None if default else project}
                      for cid, title, project, default in found[:20]], "more": len(found) > 20}

def check_edition(record, edition):
    if record.draft_sha256 != edition or not record.draft_storage_uri:
        raise HTTPException(409, {"code": "APPEND_SOURCE_CHANGED"})


@router.get("/api/append-imports/{iid}/choices")
def page(iid: UUID, request: Request, response: Response, edition: str = Query(pattern=r"^[a-f0-9]{64}$"),
         volume: int = Query(ge=0), page: int = Query(ge=0), db: Session = DB):
    response.headers["Cache-Control"] = "private, no-store"
    r = source(db, request, iid)
    check_edition(r, edition)
    try:
        rows = choices.read_page(r, choices.book(r, volume), page)
    except AdaptiveImportError as exc:
        raise HTTPException(409, {"code": exc.code}) from exc
    return {"items": [{k: row[k] for k in ("index", "role", "text", "assets", "turn", "missing")} for row in rows],
            "page_size": choices.PAGE}


RangeIndex = Annotated[int, Field(strict=True, ge=0, le=choices.MAX_ORDINAL)]


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: UUID
    edition: str = Field(pattern=r"^[a-f0-9]{64}$")
    volume: int = Field(ge=0)
    indexes: list[int] | None = Field(default=None, min_length=1, max_length=choices.MAX_SELECTION)
    ranges: list[tuple[RangeIndex, RangeIndex]] | None = Field(default=None, min_length=1, max_length=choices.MAX_RANGES)
    selected_count: RangeIndex | None = None

    @model_validator(mode="after")
    def selection_encoding(self):
        if self.ranges is None:
            if self.indexes is None or self.selected_count is not None:
                raise ValueError("Provide indexes or ranges with selected_count.")
        else:
            if self.indexes is not None:
                raise ValueError("Use only one selection encoding.")
            try:
                self.ranges = [tuple(pair) for pair in choices.selection_ranges(
                    ranges=self.ranges, selected_count=self.selected_count)]
            except AdaptiveImportError:
                raise ValueError("Ranges must be ordered, non-overlapping and match selected_count.") from None
        return self

    def coordinates(self):
        return {"indexes": self.indexes} if self.ranges is None else {"ranges": self.ranges, "selected_count": self.selected_count}


class Confirm(Selection):
    receipt: str = Field(pattern=r"^[a-f0-9]{64}$")
    allow_share: bool = False
    allow_partial: bool = False
    allow_changed: bool = False


def reviewed(db, r, body, *, lock=False):
    check_edition(r, body.edition)
    if r.status not in {"previewed", "failed"} or r.status == "failed" and not service.submitted_decision(r.analysis_summary):
        raise HTTPException(409, {"code": "APPEND_NOT_READY"})
    failure = public_failure(r)
    if failure and failure["code"] in {
        "READER_PACKAGE_INVALID", "SOURCE_CHANGED", "SOURCE_PATH_INVALID", "ZIP_SOURCE_CHANGED",
        "ZIP_CRC_INVALID", "ZIP_INVALID", "ZIP_MANIFEST_INVALID",
    }:
        # An intact choice spool is not proof that its durable draft/ZIP is
        # intact. Reconfirming the same failed bytes cannot repair integrity.
        raise HTTPException(409, {"code": "APPEND_SOURCE_CHANGED"})
    try:
        return service.review(db, r, body.target, body.volume, **body.coordinates(), lock=lock)[0]
    except AdaptiveImportError as exc:
        raise HTTPException(409, {"code": exc.code}) from exc


@router.post("/api/append-imports/{iid}/review")
def preview(iid: UUID, body: Selection, request: Request, db: Session = DB):
    return reviewed(db, source(db, request, iid), body)


@router.post("/api/append-imports/{iid}/confirm", status_code=202)
def confirm(iid: UUID, body: Confirm, request: Request, response: Response, db: Session = DB):
    r = source(db, request, iid, lock=True)
    decision = body.model_dump(mode="json", exclude_none=True)
    if "indexes" in decision:
        decision["indexes"] = sorted(decision["indexes"])
    if r.status in {"committed", "queued", "processing"}:
        if service.submitted_decision(r.analysis_summary) != decision:
            raise HTTPException(409, {"code": "APPEND_ALREADY_SUBMITTED"})
        response.status_code = 200 if r.status == "committed" else 202
        return metadata(r)
    current = reviewed(db, r, body, lock=True)
    if not service.consent(current, decision):
        raise HTTPException(409, {"code": "APPEND_REVIEW_CHANGED", "review": current})
    r.analysis_summary = service.with_submitted_decision(r.analysis_summary, decision)
    queue_import(r, db)
    db.commit()
    return metadata(r)
