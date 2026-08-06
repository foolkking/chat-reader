from __future__ import annotations

import argparse
import json

from app.core.database import SessionLocal
from app.models import Conversation


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Permanently remove conversations left by the retired Trash workflow."
    )
    parser.add_argument("--execute", action="store_true", help="Commit the deletion. Default is dry-run.")
    args = parser.parse_args()

    with SessionLocal() as db:
        rows = (
            db.query(Conversation)
            .filter((Conversation.status == "deleted") | Conversation.deleted_at.is_not(None))
            .order_by(Conversation.id)
            .all()
        )
        count = len(rows)
        if args.execute:
            for row in rows:
                db.delete(row)
            db.commit()
        else:
            db.rollback()

    print(json.dumps({"execute": args.execute, "conversation_count": count}, sort_keys=True))


if __name__ == "__main__":
    main()
