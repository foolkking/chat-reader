"""Opt-in benchmark: run with the API on PYTHONPATH, on an EMPTY disposable PostgreSQL DB."""
import argparse
import json
import math
import time
import uuid

from sqlalchemy import create_engine, event, insert, select, func, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.search_document import SearchDocument
from app.models.user import User
from app.services.extension_catalog import catalog
from app.services.ownership import OwnershipScope


def main():
    arg = argparse.ArgumentParser()
    arg.add_argument("url")
    opts = make_url(arg.parse_args().url)
    if opts.host != "127.0.0.1" or opts.database != "reader_unified_bench" or opts.get_backend_name() != "postgresql":
        raise SystemExit("Disposable loopback reader_unified_bench only")
    engine = create_engine(opts)
    with Session(engine) as db:
        if db.scalar(select(func.count()).select_from(Conversation)) or db.scalar(select(func.count()).select_from(SearchDocument)):
            raise SystemExit("Refusing to modify existing conversations or index")
        user = User(display_name="Catalog benchmark"); db.add(user); db.flush()
        project = Project(owner_user_id=user.id, name="Synthetic tide project"); db.add(project); db.flush()
        for batch in range(100):
            rows = [{"id": uuid.uuid4(), "owner_user_id": user.id, "title": f"Synthetic {batch}-{i}",
                     "display_title": f"Synthetic {batch}-{i}", "source_type": "bench", "source_profile": "bench", "parser_version": "test"} for i in range(100)]
            db.execute(insert(Conversation), rows)
            if not batch:
                db.execute(insert(ProjectConversation), [{"project_id":project.id,"conversation_id":r["id"]} for r in rows[:29]])
            db.execute(insert(SearchDocument), [{"conversation_id":r["id"],"document_type":"message","role":"assistant",
                "plain_text":"abyssal benchmark text","search_text":"abyssal benchmark text"} for r in rows for _ in range(10)])
        db.execute(text("ANALYZE conversations")); db.execute(text("ANALYZE search_documents"))
        counts = [db.scalar(select(func.count()).select_from(t)) for t in (Conversation, SearchDocument)]
        stats = {}; statements = []
        @event.listens_for(engine, "before_cursor_execute")
        def record(conn, cursor, sql, *args):
            statements.append(sql.lower())
        for mode in (False, True):
            for q, expected in (("tide project",29), ("abyssal",0), ("Synthetic 89-18",1)):
                samples = []
                for i in range(22):
                    statements.clear(); start = time.perf_counter()
                    page = catalog(db, OwnershipScope(user.id), q, None, "all", "recent", 0, 40, names_only=mode)
                    if i >= 2:
                        samples.append(1000 * (time.perf_counter() - start))
                    if mode:
                        assert len(page["items"]) == expected and not page["has_more"]
                        assert not any("search_documents" in s for s in statements)
                p95 = sorted(samples)[math.ceil(.95 * len(samples)) - 1]
                stats[f"{'names' if mode else 'full'}:{q}"] = dict(p95_ms=round(p95,2), first_page=len(page["items"]),more=page["has_more"])
        print(json.dumps(dict(counts=counts,hot_samples=20,results=stats),indent=2))
        assert all(v["p95_ms"] <= 200 for k,v in stats.items() if k.startswith("names:"))
        db.rollback()  # Workload never becomes durable.


if __name__ == "__main__":
    main()
