import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.content_cleanup import ContentCleanupRule as Rule, ContentCleanupRuleRevision as Revision, ContentCleanupRulePublication as Publication, ContentCleanupRuleAlias as Alias
from app.models.import_record import utc_now
from app.services.administration import require_root_admin, record_admin_audit, request_id_from
from app.services.cleanup_rule_access import canonical_rule_id, publish_rule, related_rule_ids
from app.services.cleanup_rule_identity import MATCH_FIELDS, configuration_digest_v1

router = APIRouter(prefix="/api/admin/noise-rules", tags=["admin-noise-rules"])


class PublicationInput(BaseModel):
    revision_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)


def _revision_payload(rule: Rule, revision: Revision) -> dict:
    config = {key: getattr(revision, key) for key in MATCH_FIELDS}
    return {"id": str(revision.id), "revision": revision.revision, "configuration": config,
        "validated": revision.configuration_digest == configuration_digest_v1(config, scope=rule.scope), "created_at": revision.created_at}


@router.get("")
def candidates(request: Request, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)) -> dict:
    require_root_admin(request, db)
    query = db.query(Rule).filter(Rule.kind == "USER_LITERAL", ~Rule.id.in_(db.query(Alias.old_rule_id)))
    total = query.count()
    items = []
    for rule in query.order_by(Rule.created_at.desc(), Rule.id).offset(offset).limit(limit):
        publication = db.get(Publication, rule.id)
        count = db.query(Revision.id).filter(Revision.rule_id.in_(related_rule_ids(db, rule.id))).count()
        items.append({"id": str(rule.id), "name": publication.name if publication else "Text rule",
            "source_account_available": rule.owner_user_id is not None, "revision_count": count,
            "published_revision_id": str(publication.revision_id) if publication and publication.withdrawn_at is None else None})
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{rule_id}/revisions")
def revisions(rule_id: uuid.UUID, request: Request, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)) -> dict:
    require_root_admin(request, db)
    rule = db.get(Rule, canonical_rule_id(db, rule_id))
    if rule is None or rule.kind != "USER_LITERAL":
        raise HTTPException(status_code=404, detail="Noise rule not found.")
    query = db.query(Revision).filter(Revision.rule_id.in_(related_rule_ids(db, rule.id)))
    return {"items": [_revision_payload(rule, item) for item in query.order_by(Revision.revision.desc(), Revision.created_at.desc()).offset(offset).limit(limit)],
        "total": query.count(), "limit": limit, "offset": offset}


@router.put("/{rule_id}/publication")
def publish(rule_id: uuid.UUID, payload: PublicationInput, request: Request, db: Session = Depends(get_db)) -> dict:
    actor = require_root_admin(request, db)
    try:
        publication = publish_rule(db, rule_id, payload.revision_id, actor.id, payload.name)
        record_admin_audit(db, actor_user_id=actor.id, action="NOISE_RULE_PUBLISHED", resource_type="NOISE_RULE", resource_id=publication.rule_id,
            metadata={"revision_id": str(publication.revision_id)}, request_id=request_id_from(request))
        db.commit()
        return {"rule_id": str(publication.rule_id), "revision_id": str(publication.revision_id), "published": True}
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/{rule_id}/publication", status_code=204)
def withdraw(rule_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> Response:
    actor = require_root_admin(request, db)
    canonical = canonical_rule_id(db, rule_id)
    db.query(Rule).filter_by(id=canonical).with_for_update().first()
    publication = db.get(Publication, canonical)
    if publication and publication.withdrawn_at is None:
        publication.withdrawn_at = utc_now()
        record_admin_audit(db, actor_user_id=actor.id, action="NOISE_RULE_WITHDRAWN", resource_type="NOISE_RULE", resource_id=canonical, request_id=request_id_from(request))
    db.commit()
    return Response(status_code=204)
