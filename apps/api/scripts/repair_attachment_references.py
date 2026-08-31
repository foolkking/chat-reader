from __future__ import annotations

import argparse
import json
import uuid

from app.core.database import SessionLocal
from app.services.editing.attachment_reference_repair import (
    AttachmentReferenceRepairError,
    apply_unique_attachment_reference_repair,
    plan_unique_attachment_reference_repair,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Dry-run or explicitly apply unique merged-attachment reference repairs.",
    )
    parser.add_argument("--conversation-id", type=uuid.UUID, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-token")
    args = parser.parse_args()
    if args.apply and not args.confirm_token:
        parser.error("--apply requires --confirm-token from a fresh dry-run")

    try:
        with SessionLocal() as db:
            plan = plan_unique_attachment_reference_repair(db, args.conversation_id)
            repaired_message_count = 0
            if args.apply:
                repaired_message_count = apply_unique_attachment_reference_repair(
                    db,
                    args.conversation_id,
                    confirmation_token=args.confirm_token,
                )
                db.commit()
            else:
                db.rollback()
    except AttachmentReferenceRepairError as exc:
        parser.error(str(exc))

    print(json.dumps({
        "dry_run": not args.apply,
        "applicable": plan.applicable,
        "conversation_id": str(plan.conversation_id),
        "confirmation_token": plan.confirmation_token,
        "scanned_message_count": plan.scanned_message_count,
        "repairable_message_count": plan.repairable_message_count,
        "repairable_reference_count": plan.repairable_reference_count,
        "unresolved_reference_ids": [str(item) for item in plan.unresolved_reference_ids],
        "ambiguous_reference_ids": [str(item) for item in plan.ambiguous_reference_ids],
        "repaired_message_count": repaired_message_count,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
