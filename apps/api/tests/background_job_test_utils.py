import uuid

from sqlalchemy.orm import sessionmaker

from app.core.database import get_db
from app.main import app
from app.services.background_jobs import claim_next_job, process_background_job


def process_queued_jobs(*, until_job_id: str | None = None, max_jobs: int = 20) -> list[uuid.UUID]:
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    try:
        factory = sessionmaker(bind=db.get_bind(), autoflush=False, autocommit=False)
    finally:
        db.close()
        generator.close()

    target = uuid.UUID(until_job_id) if until_job_id else None
    processed: list[uuid.UUID] = []
    for _ in range(max_jobs):
        with factory() as claim_db:
            claimed_id = claim_next_job(claim_db)
            claim_db.commit()
        if claimed_id is None:
            if target is None:
                return processed
            break
        process_background_job(claimed_id, session_factory=factory)
        processed.append(claimed_id)
        if claimed_id == target:
            return processed
    if target is not None:
        raise AssertionError(f"Target background job was not processed: {target}")
    raise AssertionError(f"Background queue did not drain within {max_jobs} jobs.")
