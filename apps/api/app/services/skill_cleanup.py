"""Delete logical Skill history transactionally, then reclaim unreferenced files."""
from __future__ import annotations

from app.models.background_job import BackgroundJob
from app.models.skill_bundle import SkillBundleMember, SkillBundleRevision, SkillFileObject
from app.models.user_skill import UserSkill
from app.services.assets.asset_store import get_asset_store


def detach_skill_history(db, item):
    # Match replacement's owner-row lock so a late revision cannot survive deletion.
    db.query(type(item)).filter(type(item).id == item.id).with_for_update().populate_existing().one()
    owner = SkillBundleRevision.user_skill_id if isinstance(item, UserSkill) else SkillBundleRevision.system_skill_id
    revisions = db.query(SkillBundleRevision.id).filter(owner == item.id)
    members = db.query(SkillBundleMember).filter(SkillBundleMember.revision_id.in_(revisions))
    keys = []
    while objects := db.query(SkillFileObject).filter(
        SkillFileObject.sha256.in_(members.with_entities(SkillBundleMember.object_sha256))
    ).order_by(SkillFileObject.sha256).limit(250).with_for_update().all():
        hashes = [obj.sha256 for obj in objects]
        members.filter(SkillBundleMember.object_sha256.in_(hashes)).delete(synchronize_session=False)
        db.flush()
        for obj in objects:
            if db.query(SkillBundleMember.revision_id).filter_by(object_sha256=obj.sha256).first() is None:
                keys.append(obj.storage_key)
                db.delete(obj)
        db.flush()
    db.query(SkillBundleRevision).filter(owner == item.id).delete(synchronize_session=False)
    db.flush()
    return keys


def queue_skill_cleanup(db, keys, *, owner_user_id):
    if not keys:
        return None
    job = BackgroundJob(owner_user_id=owner_user_id, job_type='skill_object_cleanup',
                        status='queued', phase='queued', total_items=len(keys),
                        payload={'keys': list(dict.fromkeys(keys))}, result={})
    db.add(job)
    db.flush()
    return job


def cleanup_skill_objects(db, keys, *, progress=None):
    """Keys are server-created and never returned in task results. Safe to replay."""
    removed, retained = 0, 0
    for index, key in enumerate(keys):
        if (not isinstance(key, str) or not key.startswith('skills/objects/')
                or any(part in {'', '.', '..'} for part in key.split('/')) or '\\' in key):
            raise ValueError('Skill cleanup contains an invalid resource reference.')
        if db.query(SkillFileObject.sha256).filter_by(storage_key=key).first() is not None:
            retained += 1
        else:
            try:
                get_asset_store().delete_key(key)
            except Exception:
                raise ValueError('Skill file cleanup failed; retry the task.') from None
            removed += 1
        if progress and (index % 50 == 0 or index + 1 == len(keys)):
            progress('cleaning_skill_files', min(99, int((index + 1) * 99 / max(1, len(keys)))), index + 1, len(keys))
    return {'removed_files': removed, 'retained_files': retained}
