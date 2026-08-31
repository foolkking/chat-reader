from __future__ import annotations

import argparse
from collections import Counter
import json
import uuid

from app.core.database import SessionLocal
from app.models.conversation import Conversation
from app.services.editing.attachment_integrity import audit_conversation_attachment_integrity


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only attachment reference integrity report.")
    parser.add_argument(
        "--conversation-id",
        type=uuid.UUID,
        help="Limit the report to one Conversation and include object identity details.",
    )
    parser.add_argument("--max-conversations", type=int, default=10_000)
    args = parser.parse_args()
    if args.max_conversations < 1:
        parser.error("--max-conversations must be at least 1")

    with SessionLocal() as db:
        if args.conversation_id is not None:
            conversation_ids = [args.conversation_id]
            complete = True
        else:
            rows = (
                db.query(Conversation.id)
                .filter(Conversation.deleted_at.is_(None))
                .order_by(Conversation.id)
                .limit(args.max_conversations + 1)
                .all()
            )
            complete = len(rows) <= args.max_conversations
            conversation_ids = [row[0] for row in rows[:args.max_conversations]]

        issues = [
            issue
            for conversation_id in conversation_ids
            for issue in audit_conversation_attachment_integrity(db, conversation_id)
        ]
        db.rollback()

    payload: dict[str, object] = {
        "read_only": True,
        "complete": complete,
        "scanned_conversation_count": len(conversation_ids),
        "affected_conversation_count": len({issue.conversation_id for issue in issues}),
        "issue_count": len(issues),
        "issue_counts": dict(sorted(Counter(issue.code for issue in issues).items())),
    }
    if args.conversation_id is not None:
        payload["conversation_id"] = str(args.conversation_id)
        payload["issues"] = [
            {
                "code": issue.code,
                "message_id": str(issue.message_id) if issue.message_id else None,
                "message_version_id": str(issue.message_version_id) if issue.message_version_id else None,
                "attachment_id": str(issue.attachment_id) if issue.attachment_id else None,
                "occurrence_id": str(issue.occurrence_id) if issue.occurrence_id else None,
                "block_index": issue.block_index,
            }
            for issue in issues
        ]
    print(json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()
