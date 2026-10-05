"""Direct private file snapshots; historical candidate operations are retired."""
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.context_continuation import ContextMemberObject, ContinuationState
from app.services.continuation_candidates import (
    MEMBER_LIMITS, ContinuationError,
    owned_conversation, read_object,
)
from app.services.ownership import ownership_scope_from_request

router = APIRouter(prefix="/api/conversations/{conversation_id}/continuation", tags=["context-continuation"])


@router.post('/returns', status_code=202)
def post_return(conversation_id: uuid.UUID, request: Request, file: UploadFile = File(...),
                base_generation: int = Form(..., ge=0), idempotency_key: str = Form(..., min_length=1, max_length=128), db: Session = Depends(get_db)):
    from app.services.context_return_jobs import receive_context_return
    try:
        job = receive_context_return(db, file.file, conversation_id, ownership_scope_from_request(request),
                                     base_generation=base_generation, idempotency_key=idempotency_key)
        db.commit()
        return {'task_id': job.id, 'status': job.status}
    except ContinuationError as exc:
        fail(db, exc)


def fail(db, exc):
    db.rollback()
    raise HTTPException(exc.status_code, detail={"code": exc.code}) from exc


async def upload_members(current, index, manifest):
    members = {}
    for name, file in (("current", current), ("index", index), ("manifest", manifest)):
        if file is not None:
            raw = await file.read(MEMBER_LIMITS[name] + 1)
            if len(raw) > MEMBER_LIMITS[name]:
                raise ContinuationError("CONTEXT_MEMBER_TOO_LARGE", 413)
            members[name] = raw
    return members


@router.get("")
def get_status(conversation_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    try:
        scope = ownership_scope_from_request(request)
        owned_conversation(db, conversation_id, scope)
        state = db.get(ContinuationState, conversation_id)
        from app.models.background_job import BackgroundJob
        pending = db.query(BackgroundJob).filter(
            scope.predicate(BackgroundJob), BackgroundJob.job_type == 'context_return',
            BackgroundJob.status.in_(['queued', 'processing', 'cancelling']),
            BackgroundJob.payload['conversation_id'].as_string() == str(conversation_id),
        ).order_by(BackgroundJob.created_at.desc()).first()
        return {"generation": state.generation if state else 0,
                "adopted_revision_id": state.adopted_revision_id if state else None,
                "pending_return_task_id": pending.id if pending else None}
    except ContinuationError as exc:
        fail(db, exc)


@router.get('/revisions')
def list_revisions(conversation_id: uuid.UUID, request: Request, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    from app.models.context_continuation import ContinuationRevision
    try:
        owned_conversation(db, conversation_id, ownership_scope_from_request(request))
        rows = db.query(ContinuationRevision).filter_by(conversation_id=conversation_id).order_by(
            ContinuationRevision.created_at.desc(), ContinuationRevision.id.desc()).offset(offset).limit(limit).all()
        return [{'id': row.id, 'parent_id': row.parent_id, 'branch_key': row.branch_key,
                 'protocol_revision': row.protocol_revision, 'schema_version': row.schema_version,
                 'declared_trust': row.declared_trust, 'source_metadata': row.source_metadata,
                 'members': {name: bool(getattr(row, name + '_sha256')) for name in ('current', 'index')},
                 'created_at': row.created_at} for row in rows]
    except ContinuationError as exc:
        fail(db, exc)


@router.get('/guidance')
def get_guidance(conversation_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    from app.services.continuation_guidance import guidance_counts
    try:
        conversation = owned_conversation(db, conversation_id, ownership_scope_from_request(request))
        return guidance_counts(db, conversation)
    except ContinuationError as exc:
        fail(db, exc)


@router.get('/revisions/{revision_id}/members/{member}')
def get_revision_member(conversation_id: uuid.UUID, revision_id: uuid.UUID, member: str, request: Request, db: Session = Depends(get_db)):
    from app.models.context_continuation import ContinuationRevision
    try:
        owned_conversation(db, conversation_id, ownership_scope_from_request(request))
        row = db.query(ContinuationRevision).filter_by(conversation_id=conversation_id, id=revision_id).one_or_none()
        if row is None or member not in {'current', 'index'}:
            raise ContinuationError('CONTEXT_REVISION_NOT_FOUND', 404)
        digest = getattr(row, member + '_sha256')
        if digest is None:
            raise ContinuationError('CONTEXT_MEMBER_NOT_FOUND', 404)
        return PlainTextResponse(read_object(db.get(ContextMemberObject, digest)),
                                 headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
    except ContinuationError as exc:
        fail(db, exc)


@router.put("/files")
async def put_files(conversation_id: uuid.UUID, request: Request, base_generation: int = Form(..., ge=0),
                    current: UploadFile | None = File(None), index: UploadFile | None = File(None), db: Session = Depends(get_db)):
    from app.services.continuation_files import update_files
    try:
        scope = ownership_scope_from_request(request)
        owned_conversation(db, conversation_id, scope)
        members = await upload_members(current, index, None)
        row, state = update_files(db, conversation_id, scope, members=members, base_generation=base_generation)
        db.commit()
        return {"revision_id": row.id, "generation": state.generation}
    except ContinuationError as exc:
        fail(db, exc)


@router.api_route('/candidates', methods=['GET', 'POST', 'PUT', 'DELETE'], include_in_schema=False)
@router.api_route('/candidates/{retired_path:path}', methods=['GET', 'POST', 'PUT', 'DELETE'], include_in_schema=False)
def retired_candidates(conversation_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    # Check ownership before revealing that this conversation has a retired route.
    try:
        owned_conversation(db, conversation_id, ownership_scope_from_request(request))
    except ContinuationError as exc:
        fail(db, exc)
    raise HTTPException(410, {'code': 'CONTEXT_CANDIDATE_FLOW_RETIRED', 'next_action': 'update_files'})
