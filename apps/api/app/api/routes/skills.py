from app.services.skill_bundles import bundle_disposition
import unicodedata
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import PlainTextResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.models.user_skill import UserSkill
from app.models.administration import SystemSkill
from app.schemas.skills import SkillDetail, SkillRead, SkillResolve, SkillSelectionUpdate, SkillUpdate
from app.services.skills import clear_skill_selection, create_skill, get_user_skill, list_skills, lock_skill_scope, resolve_skill, selected_id, update_selection
from app.services.ownership import subject_key_from_request
from app.services.feature_policies import get_feature_policy
from app.services.skill_bundles import (MAX_UPLOAD, parse_bundle, save_revision, revision_query,
                                       member_rows, read_member, download_revision, legacy_bundle, encode_bundle)

router = APIRouter(prefix="/api/skills", tags=["skills"])

ALLOWED_TEXT_CONTROLS = frozenset({"\t", "\n", "\r"})


def subject(request: Request) -> str:
    return subject_key_from_request(request)


def read_item(item: UserSkill, selected: bool = False) -> dict:
    return {"id": str(item.id), "source": "USER", "category": item.category, "locale": item.locale, "name": item.name, "status": item.status, "is_selected": selected, "updated_at": item.updated_at, "byte_size": item.byte_size, "content_url": f"/api/skills/{item.id}/content", "is_customized": False, "default_enabled": False,
            "bundle_revision": item.bundle_revision, "bundle_url": f"/api/skills/{item.id}/bundle?revision={item.bundle_revision}"}


def contains_binary_controls(content: str) -> bool:
    return any(character not in ALLOWED_TEXT_CONTROLS and unicodedata.category(character) == "Cc" for character in content)


@router.get("", response_model=list[SkillRead])
def get_skills(request: Request, category: str | None = Query(default=None), locale: str | None = Query(default=None), db: Session = Depends(get_db)):
    return list_skills(db, category, locale, subject(request))


@router.get("/resolve", response_model=SkillResolve)
def resolve(request: Request, category: str, locale: str = "zh-CN", db: Session = Depends(get_db)):
    try: result = resolve_skill(db, category=category, locale=locale, subject_key=subject(request)); db.commit(); return result
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc


@router.post("", response_model=SkillRead, status_code=status.HTTP_201_CREATED)
async def upload_skill(request: Request, category: str = Form(...), locale: str = Form("zh-CN"), name: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    policy = get_feature_policy(db)
    if not policy.allow_user_skills or not policy.allow_skill_import:
        raise HTTPException(403, "User Skill import is disabled by the system administrator.")
    if not (file.filename or '').lower().endswith(('.zip', '.md')):
        raise HTTPException(422, 'Upload a Skill ZIP or Markdown file.')
    limit = MAX_UPLOAD
    raw = await file.read(limit + 1)
    if len(raw) > limit: raise HTTPException(413, "Skill file exceeds the upload limit.")
    try:
        bundle = parse_bundle(raw, file.filename or '')
        item = create_skill(db, category=category, locale=locale, name=name, content=bundle.content, subject_key=subject(request),
                            bundle_digest=bundle.digest if bundle.source_kind == 'BUNDLE' else None)
        save_revision(db, item, bundle, base_revision=0, preserve_baseline=False)
        db.commit(); db.refresh(item)
        return read_item(item)
    except KeyError as exc: db.rollback(); raise HTTPException(409, "An identical Skill already exists for this purpose.") from exc
    except IntegrityError as exc: db.rollback(); raise HTTPException(409, 'An identical Skill already exists.') from exc
    except ValueError as exc: db.rollback(); raise HTTPException(422, str(exc)) from exc


def _owned(skill_id, request, db):
    item = get_user_skill(db, skill_id, subject(request))
    if item is None:
        raise HTTPException(404, 'Skill not found.')
    return item


def _revision(db, item, number):
    from app.models.skill_bundle import SkillBundleRevision
    row = revision_query(db, item).filter(SkillBundleRevision.revision == number).first()
    if row is None:
        raise HTTPException(404, 'Skill revision not found.')
    return row


@router.post('/{skill_id}/revisions', response_model=SkillRead)
async def replace_bundle(skill_id: uuid.UUID, request: Request, file: UploadFile = File(...),
                         base_revision: int = Form(..., ge=0), db: Session = Depends(get_db)):
    item = _owned(skill_id, request, db)
    policy = get_feature_policy(db)
    if not policy.allow_user_skills or not policy.allow_skill_import:
        raise HTTPException(403, 'Skill replacement is disabled.')
    data = await file.read(MAX_UPLOAD + 1)
    if not (file.filename or '').lower().endswith(('.zip', '.md')):
        raise HTTPException(422, 'Upload a Skill ZIP or Markdown file.')
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, 'Skill Bundle exceeds the upload limit.')
    try:
        save_revision(db, item, parse_bundle(data, file.filename or ''), base_revision=base_revision)
        db.commit(); db.refresh(item)
        return read_item(item, selected_id(db, item.category, item.locale, subject(request)) == item.id)
    except RuntimeError as exc:
        db.rollback(); raise HTTPException(409, str(exc)) from exc
    except IntegrityError as exc:
        db.rollback(); raise HTTPException(409, 'An identical Skill already exists.') from exc
    except ValueError as exc:
        db.rollback(); raise HTTPException(422, str(exc)) from exc


@router.get('/{skill_id}/revisions')
def revisions(skill_id: uuid.UUID, request: Request, offset: int = Query(0, ge=0),
              limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db)):
    item = _owned(skill_id, request, db)
    from app.models.skill_bundle import SkillBundleRevision
    return [{'revision': row.revision, 'digest': row.digest, 'source_kind': row.source_kind,
             'byte_size': row.byte_size, 'created_at': row.created_at,
             'is_current': row.revision == item.bundle_revision}
            for row in revision_query(db, item).order_by(SkillBundleRevision.revision.desc()).offset(offset).limit(limit).all()]


@router.get('/{skill_id}/bundle')
def bundle_download(skill_id: uuid.UUID, request: Request, revision: int = Query(..., ge=0), db: Session = Depends(get_db)):
    item = _owned(skill_id, request, db)
    if revision == 0 and item.bundle_revision == 0:
        # Lazy compatibility wrapping preserves untouched historical rows.
        content = encode_bundle(legacy_bundle(item.content))
    else:
        content = download_revision(db, _revision(db, item, revision))
    return Response(content, media_type='application/zip', headers={
        'Content-Disposition': bundle_disposition(item.name), 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'})


@router.get('/{skill_id}/revisions/{number}/members')
def members(skill_id: uuid.UUID, number: int, request: Request, db: Session = Depends(get_db)):
    row = _revision(db, _owned(skill_id, request, db), number)
    return [{'path': member.path, 'byte_size': obj.byte_size, 'sha256': obj.sha256}
            for member, obj in member_rows(db, row)]


@router.get('/{skill_id}/revisions/{number}/member')
def member_content(skill_id: uuid.UUID, number: int, request: Request, path: str = Query(...), db: Session = Depends(get_db)):
    row = _revision(db, _owned(skill_id, request, db), number)
    obj = next((obj for member, obj in member_rows(db, row) if member.path == path), None)
    if obj is None: raise HTTPException(404, 'Skill member not found.')
    return Response(read_member(obj), media_type='text/plain', headers={
        'Content-Disposition': 'attachment; filename="skill-member.txt"', 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"})


@router.put("/selections", status_code=status.HTTP_204_NO_CONTENT)
def select_skill(payload: SkillSelectionUpdate, request: Request, db: Session = Depends(get_db)):
    if payload.skill_id is not None and not get_feature_policy(db).allow_user_skills:
        raise HTTPException(403, "User Skills are disabled by the system administrator.")
    try:
        update_selection(db, category=payload.category, locale=payload.locale, skill_id=payload.skill_id, subject_key=subject(request)); db.commit()
    except ValueError as exc:
        db.rollback(); raise HTTPException(422, str(exc)) from exc


@router.get("/system/{system_skill_id}/content", response_class=PlainTextResponse)
def get_system_skill_content(system_skill_id: uuid.UUID, db: Session = Depends(get_db)):
    item = db.get(SystemSkill, system_skill_id)
    if item is None or item.status != "ACTIVE" or item.content is None:
        raise HTTPException(404, "System Skill content not found.")
    return PlainTextResponse(
        item.content,
        headers={"Content-Disposition": f'attachment; filename="system-skill-{item.id}.md"'},
    )


@router.get('/system/{system_skill_id}/bundle')
def system_bundle_download(system_skill_id: uuid.UUID, revision: int = Query(..., ge=0), db: Session = Depends(get_db)):
    item = db.get(SystemSkill, system_skill_id)
    # Public system distribution exposes the active revision only, never withdrawn history.
    if item is None or item.status != 'ACTIVE' or item.bundle_revision != revision:
        raise HTTPException(404, 'System Skill revision unavailable.')
    if revision == 0:
        if item.content is None: raise HTTPException(404, 'Use the bundled distribution URL.')
        content = encode_bundle(legacy_bundle(item.content))
    else:
        content = download_revision(db, _revision(db, item, revision))
    return Response(content, media_type='application/zip', headers={
        'Content-Disposition': bundle_disposition(item.name), 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'})


@router.get("/{skill_id}", response_model=SkillDetail)
def get_skill(skill_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    item = get_user_skill(db, skill_id, subject(request))
    if item is None: raise HTTPException(404, "Skill not found.")
    return {**read_item(item), "content": item.content}


@router.get("/{skill_id}/content", response_class=PlainTextResponse)
def get_skill_content(skill_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    item = get_user_skill(db, skill_id, subject(request))
    if item is None: raise HTTPException(404, "Skill not found.")
    return PlainTextResponse(item.content, headers={"Content-Disposition": f'attachment; filename="skill-{item.id}.md"'})


@router.patch("/{skill_id}", response_model=SkillRead)
def patch_skill(skill_id: uuid.UUID, payload: SkillUpdate, request: Request, db: Session = Depends(get_db)):
    item = get_user_skill(db, skill_id, subject(request))
    if item is None: raise HTTPException(404, "Skill not found.")
    lock_skill_scope(db, subject(request), item.category)
    item = db.scalar(select(UserSkill).where(UserSkill.id == skill_id, UserSkill.subject_key == subject(request)).execution_options(populate_existing=True))
    if item is None: raise HTTPException(404, "Skill not found.")
    if payload.name is not None: item.name = payload.name.strip()
    if payload.status is not None:
        item.status = payload.status
        if payload.status == "DISABLED":
            clear_skill_selection(db, item)
    db.commit(); db.refresh(item)
    selected = False
    selected = selected_id(db, item.category, item.locale, subject(request)) == item.id
    return read_item(item, selected)


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_skill(skill_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    item = get_user_skill(db, skill_id, subject(request))
    if item is None: raise HTTPException(404, "Skill not found.")
    lock_skill_scope(db, subject(request), item.category)
    item = db.scalar(select(UserSkill).where(UserSkill.id == skill_id, UserSkill.subject_key == subject(request)).execution_options(populate_existing=True))
    if item is None: raise HTTPException(404, "Skill not found.")
    clear_skill_selection(db, item)
    from app.services.skill_cleanup import detach_skill_history, queue_skill_cleanup
    from app.services.ownership import ownership_scope_from_request
    keys = detach_skill_history(db, item)
    queue_skill_cleanup(db, keys, owner_user_id=ownership_scope_from_request(request).owner_user_id)
    db.delete(item); db.commit()
