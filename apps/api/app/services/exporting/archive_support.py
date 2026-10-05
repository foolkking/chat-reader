"""Portable request history. Personal restore never recreates grants or sends mail."""
import hashlib
import uuid

from app.models.support_request import SupportMessage, SupportRequest, UserLimitOverride
from app.schemas.support_request import RequestedLimits
from app.services.exporting.system_archive import SystemArchiveError, _decode_payload

SUPPORT_TABLES = {"support_requests", "support_messages", "user_limit_overrides"}


def support_table_models(models, manifest):
    version = manifest.get("support_requests_version")
    if version is not None and (type(version) is not int or version != 1
                               or not {"support_requests", "support_messages"} <= models.keys()):
        raise SystemArchiveError("Unsupported support archive extension.")
    return {name: model for name, model in models.items() if version is not None or name not in SUPPORT_TABLES}


def portable_support_payload(name, payload):
    if name == "support_messages":
        payload = {**payload, "notification_job_id": None}
        if payload.get("mail_state") in {"QUEUED", "SENDING"}:
            payload["mail_state"] = "UNKNOWN"
    if name == "user_limit_overrides":
        payload = {**payload, "last_operation_key": None, "last_operation_digest": None}
    return payload


def validate_support_archive(archive):
    from app.services.support_requests import KINDS, STATUSES
    owners = {}
    request_keys, message_keys = set(), set()
    system = "users" in archive.table_models
    for row in archive.rows("support_requests"):
        if row["kind"] not in KINDS or row["status"] not in STATUSES or row["revision"] < 1:
            raise SystemArchiveError("Invalid support request state.")
        if not row["title"].strip():
            raise SystemArchiveError("Invalid support request title.")
        for field in ("requested_limits", "approved_limits"):
            RequestedLimits.model_validate(row[field])
        if row["kind"] != "LIMIT" and (row["requested_limits"] or row["approved_limits"]):
            raise SystemArchiveError("Non-limit request contains limits.")
        key = (row["owner_user_id"], row["creation_key"])
        if key in request_keys:
            raise SystemArchiveError("Duplicate support operation.")
        request_keys.add(key)
        owners[row["id"]] = row["owner_user_id"]
    for row in archive.rows("support_messages"):
        if (row["author_role"] not in {"USER", "ADMIN", "IMPORTED"} or len(row["body"]) > 20000
                or not row["body"].strip() or row.get("notification_job_id") is not None
                or row["mail_state"] not in {"NOT_REQUESTED", "UNAVAILABLE", "ACCEPTED", "FAILED", "UNKNOWN"}
                or not 0 <= row["notification_attempts"] <= 3):
            raise SystemArchiveError("Invalid support message or notification state.")
        if not system and row.get("author_user_id") not in {None, owners.get(row["request_id"])}:
            raise SystemArchiveError("Personal support history exposes another account identity.")
        if system and row.get("author_user_id") not in {None, *archive.ids["users"]}:
            raise SystemArchiveError("Support history references an unknown account.")
        key = (row["request_id"], row["operation_key"])
        if key in message_keys:
            raise SystemArchiveError("Duplicate support operation.")
        message_keys.add(key)
    for row in archive.rows("user_limit_overrides"):
        RequestedLimits.model_validate({name: row.get(name) for name in RequestedLimits.model_fields})
        if row["revision"] < 1 or len(row.get("change_reason") or "") > 20000:
            raise SystemArchiveError("Invalid limit revision.")


def restore_personal_support(db, archive, owner):
    targets = {}
    for source in archive.rows("support_requests"):
        payload = _decode_payload(SupportRequest, source)
        target = uuid.uuid4()
        targets[source["id"]] = target
        payload.update(id=target, owner_user_id=owner, status="IMPORTED", revision=1, notify_replies=False,
                       creation_key=f"restored:{target}", creation_digest=hashlib.sha256(str(target).encode()).hexdigest())
        db.add(SupportRequest(**payload))
    db.flush()
    for source in archive.rows("support_messages"):
        payload = _decode_payload(SupportMessage, source)
        payload.update(id=uuid.uuid4(), request_id=targets[source["request_id"]], author_user_id=None,
                       notification_job_id=None, mail_state="NOT_REQUESTED", notification_attempts=0)
        db.add(SupportMessage(**payload))
    db.flush()
    return targets


def restore_system_support(db, archive, owned):
    from app.services.feature_policies import limit_bounds
    from app.services.exporting.system_archive import _restore_rows
    _restore_rows(db, SupportRequest, owned("support_requests"), overrides={"notify_replies": False})
    _restore_rows(db, SupportMessage, owned("support_messages"),
                  overrides={"notification_job_id": None, "mail_state": "NOT_REQUESTED", "notification_attempts": 0})
    # Imported operational delivery state is never replayed. Grants remain bounded
    # by the target deployment, even when its upload gateway is smaller.
    bounds = limit_bounds()
    def bounded_overrides():
        for row in owned("user_limit_overrides"):
            row = dict(row, last_operation_key=None, last_operation_digest=None)
            for field, bound in bounds.items():
                if row.get(field) is not None:
                    row[field] = min(row[field], bound)
            yield row
    _restore_rows(db, UserLimitOverride, bounded_overrides())
