"""Rescan admission, completion lookup and reversible index on actual PostgreSQL."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from sqlalchemy import text
from sqlalchemy.orm import Session
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan, ContentCleanupOccurrence
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.cleanup_scan_requests import queue_rescan, find_request
from app.services.content_cleanup import process_scan_chunk, update_decisions, apply_scan
from app.services.ownership import OwnershipScope
from test_cleanup_postgres import isolated_schema, pytestmark, seed  # noqa: F401


def test_concurrent_rescan_and_apply_keep_one_durable_receipt(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    old, message = seed(engine)
    with Session(engine) as db:
        scope = OwnershipScope(db.get(ContentCleanupScan, old).owner_user_id)
    key, barrier = uuid.uuid4(), Barrier(2)
    def admit(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            scan, job = queue_rescan(db, scope, old, key)
            ids = scan.id, job.id
            db.commit()
            return ids
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(admit, range(2)))
    assert result[0] == result[1]
    current, job_id = result[0]
    with Session(engine) as db:
        while not process_scan_chunk(db, current)["done"]:
            db.commit()
        update_decisions(db, current, {row.id: "DELETE" for row in db.query(ContentCleanupOccurrence).filter_by(scan_id=current)})
        db.commit()
        assert apply_scan(db, current)["applied"] == 1
        db.commit()
    with Session(engine) as db:
        assert find_request(db, scope, key, old).id == job_id
        assert queue_rescan(db, scope, old, key)[0] is None
        assert db.query(BackgroundJob).filter_by(owner_user_id=scope.owner_user_id).count() == 2
        assert db.query(MessageVersion).filter_by(message_id=message).count() == 2
        assert db.get(MessageVersion, db.get(Message, message).current_version_id).display_text == "Before  after."


def test_request_index_upgrade_downgrade_preserves_data_and_matches_model(isolated_schema):
    engine, migrate = isolated_schema
    # The current seed writes fields introduced after 0048. Build valid data
    # first, then exercise the actual legacy schema through downgrade.
    migrate("head")
    old, message = seed(engine)
    migrate("20261006_0048", "downgrade")
    with Session(engine) as db:
        scan = db.get(ContentCleanupScan, old)
        scope = OwnershipScope(scan.owner_user_id)
        job = db.get(BackgroundJob, scan.background_job_id)
        key = uuid.uuid4()
        job.payload = {**job.payload, "cleanup_request_key": f"rescan:{old}:{key}"}
        before = db.get(Message, message).current_version_id
        db.commit()
    index = next(item for item in BackgroundJob.__table__.indexes if item.name == "idx_background_jobs_cleanup_request")
    for target, operation in [("head", "upgrade"), ("20261006_0048", "downgrade"), ("head", "upgrade")]:
        migrate(target, operation)
        with engine.connect() as conn:
            definition = conn.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname='idx_background_jobs_cleanup_request'")).scalar()
        assert bool(definition) == (operation == "upgrade")
        with Session(engine) as db:
            assert find_request(db, scope, key, old) is not None
            assert db.get(Message, message).current_version_id == before
    # Have PostgreSQL normalize both migration and metadata DDL; compare actual
    # definitions rather than assuming stringified Python expressions agree.
    with engine.begin() as conn:
        index.drop(conn)
        index.create(conn)
        metadata_definition = conn.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname='idx_background_jobs_cleanup_request'")).scalar()
    assert definition == metadata_definition
