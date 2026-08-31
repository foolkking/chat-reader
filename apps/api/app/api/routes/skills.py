import unicodedata
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user_skill import UserSkill
from app.schemas.skills import SkillDetail, SkillRead, SkillResolve, SkillSelectionUpdate, SkillUpdate
from app.services.skills import create_skill, get_user_skill, list_skills, resolve_skill, selected_id, update_selection

router = APIRouter(prefix="/api/skills", tags=["skills"])

ALLOWED_TEXT_CONTROLS = frozenset({"\t", "\n", "\r"})


def subject(request: Request) -> str:
    return getattr(getattr(request.state, "auth", None), "principal_id", None) or "local:default"


def read_item(item: UserSkill, selected: bool = False) -> dict:
    return {"id": str(item.id), "source": "USER", "category": item.category, "locale": item.locale, "name": item.name, "status": item.status, "is_selected": selected, "updated_at": item.updated_at, "byte_size": item.byte_size, "content_url": f"/api/skills/{item.id}/content"}


def contains_binary_controls(content: str) -> bool:
    return any(character not in ALLOWED_TEXT_CONTROLS and unicodedata.category(character) == "Cc" for character in content)


@router.get("", response_model=list[SkillRead])
def get_skills(request: Request, category: str | None = Query(default=None), locale: str | None = Query(default=None), db: Session = Depends(get_db)):
    return list_skills(db, category, locale, subject(request))


@router.get("/resolve", response_model=SkillResolve)
def resolve(request: Request, category: str, locale: str, db: Session = Depends(get_db)):
    try: result = resolve_skill(db, category=category, locale=locale, subject_key=subject(request)); db.commit(); return result
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc


@router.post("", response_model=SkillRead, status_code=status.HTTP_201_CREATED)
async def upload_skill(request: Request, category: str = Form(...), locale: str = Form(...), name: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith(".md"):
        raise HTTPException(422, "Only Markdown (.md) Skill files are supported.")
    raw = await file.read(512 * 1024 + 1)
    if len(raw) > 512 * 1024: raise HTTPException(413, "Skill file exceeds 512 KiB.")
    try: content = raw.decode("utf-8")
    except UnicodeDecodeError as exc: raise HTTPException(422, "Skill file must be UTF-8 text.") from exc
    if contains_binary_controls(content):
        raise HTTPException(422, "Skill file must be plain UTF-8 text.")
    try: item = create_skill(db, category=category, locale=locale, name=name, content=content, subject_key=subject(request)); db.commit(); db.refresh(item); return read_item(item)
    except KeyError as exc: db.rollback(); raise HTTPException(409, "An identical Skill already exists for this category and language.") from exc
    except ValueError as exc: db.rollback(); raise HTTPException(422, str(exc)) from exc


@router.put("/selections", status_code=status.HTTP_204_NO_CONTENT)
def select_skill(payload: SkillSelectionUpdate, request: Request, db: Session = Depends(get_db)):
    try:
        update_selection(db, category=payload.category, locale=payload.locale, skill_id=payload.skill_id, subject_key=subject(request)); db.commit()
    except ValueError as exc:
        db.rollback(); raise HTTPException(422, str(exc)) from exc


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
    if payload.name is not None: item.name = payload.name.strip()
    if payload.status is not None:
        item.status = payload.status
        if payload.status == "DISABLED":
            from app.services.skills import selected_id, update_selection
            if selected_id(db, item.category, item.locale, subject(request)) == item.id:
                update_selection(db, category=item.category, locale=item.locale, skill_id=None, subject_key=subject(request))
    db.commit(); db.refresh(item)
    selected = False
    selected = selected_id(db, item.category, item.locale, subject(request)) == item.id
    return read_item(item, selected)


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_skill(skill_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    item = get_user_skill(db, skill_id, subject(request))
    if item is None: raise HTTPException(404, "Skill not found.")
    if selected_id(db, item.category, item.locale, subject(request)) == item.id:
        update_selection(db, category=item.category, locale=item.locale, skill_id=None, subject_key=subject(request))
    db.delete(item); db.commit()
