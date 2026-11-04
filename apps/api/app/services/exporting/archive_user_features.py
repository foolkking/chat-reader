"""Versioned additive archive extension for personal collections and read baselines."""
import uuid

from sqlalchemy import or_

from app.models.reading_content_baseline import ReadingContentBaseline, ReadingContentBaselineMessage
from app.models.user_feature_entry import UserFeatureEntry
from app.services.exporting.system_archive import SystemArchiveError, _decode_payload
from app.services.preferences import get_or_create_preferences
from app.services.user_feature_entries import VALUE_SCHEMAS, write_entry
from app.services.ownership import OwnershipScope

MODELS = {
    "user_features": UserFeatureEntry,
    "reading_baselines": ReadingContentBaseline,
    "reading_baseline_messages": ReadingContentBaselineMessage,
}


def feature_table_models(models, manifest):
    version = manifest.get("user_features_version")
    if version is None:
        return models
    if type(version) is not int or version != 1:
        raise SystemArchiveError("Unsupported personal collections archive extension.")
    return {**models, **MODELS}


def feature_queries(db, conversations, subject_keys=None):
    from sqlalchemy import String, cast, func
    # SQLite represents UUID columns without separators; JSON keeps the portable
    # RFC form. Normalize both sides rather than silently losing favorites.
    ids = conversations.with_entities(func.replace(cast(conversations.column_descriptions[0]["entity"].id, String), "-", ""))
    entries = db.query(UserFeatureEntry).filter(or_(
        UserFeatureEntry.collection != "reading-list",
        func.replace(UserFeatureEntry.value["conversation_id"].as_string(), "-", "").in_(ids),
    ))
    baselines = db.query(ReadingContentBaseline).filter(ReadingContentBaseline.conversation_id.in_(
        conversations.with_entities(conversations.column_descriptions[0]["entity"].id),
    ))
    if subject_keys is not None:
        entries = entries.filter(UserFeatureEntry.subject_key.in_(subject_keys))
        baselines = baselines.filter(ReadingContentBaseline.subject_key.in_(subject_keys))
    return {
        "user_features": entries.order_by(UserFeatureEntry.subject_key, UserFeatureEntry.collection, UserFeatureEntry.id),
        "reading_baselines": baselines.order_by(ReadingContentBaseline.id),
        "reading_baseline_messages": db.query(ReadingContentBaselineMessage).filter(
            ReadingContentBaselineMessage.baseline_id.in_(baselines.with_entities(ReadingContentBaseline.id)),
        ).order_by(ReadingContentBaselineMessage.id),
    }


def portable_feature_payload(name, payload, conversation_ids, project_ids):
    if name != "user_features":
        return payload
    value = dict(payload["value"])
    if payload["collection"] == "conversation-tag":
        value["conversation_ids"] = [item for item in value.get("conversation_ids", []) if item in conversation_ids]
    if value.get("project_id") not in project_ids:
        if "project_id" in value:
            value["project_id"] = None
    # Checklists can point to a deliberately excluded archived conversation.
    if payload["collection"] == "offline-checklist":
        value["targets"] = [item for item in value["targets"] if item["id"] in (
            project_ids if item["scope"] == "project" else conversation_ids
        )]
        if not value["targets"]:
            return None
    return {**payload, "value": value}


def validate_features(archive):
    if "user_features" not in archive.table_models:
        return
    owners = {row["id"]: str(row.get("owner_user_id") or "local:default") for row in archive.rows("conversations")}
    project_owners = {row["id"]: str(row.get("owner_user_id") or "local:default") for row in archive.rows("projects")}
    tag_owners = {row["id"]: row["subject_key"] for row in archive.rows("user_features") if row["collection"] == "conversation-tag"}
    baseline_conversations = {}
    for row in archive.rows("user_features"):
        schema = VALUE_SCHEMAS.get(row["collection"])
        if schema is None or row["revision"] < 1:
            raise SystemArchiveError("Invalid personal collection.")
        value = schema.model_validate(row["value"]).model_dump(mode="json")
        refs = value.get("conversation_ids", []) + ([value["conversation_id"]] if value.get("conversation_id") else [])
        refs.extend(item["id"] for item in value.get("targets", []) if item["scope"] == "conversation")
        for reference in refs:
            if owners.get(reference) != row["subject_key"]:
                raise SystemArchiveError("Personal collection crosses account or archive boundaries.")
        if value.get("project_id") is not None:
            archive._reference("projects", value["project_id"])
            if project_owners.get(value["project_id"]) != row["subject_key"]:
                raise SystemArchiveError("Saved search crosses project ownership.")
        for item in value.get("targets", []):
            if item["scope"] == "project":
                archive._reference("projects", item["id"])
                if project_owners.get(item["id"]) != row["subject_key"]:
                    raise SystemArchiveError("Offline checklist crosses project ownership.")
        if value.get("tag_id") and tag_owners.get(value["tag_id"]) != row["subject_key"]:
            raise SystemArchiveError("Saved search references an unavailable tag.")
    for row in archive.rows("reading_baselines"):
        if owners.get(row["conversation_id"]) != row["subject_key"]:
            raise SystemArchiveError("Reading baseline crosses accounts.")
        baseline_conversations[row["id"]] = row["conversation_id"]
    for row in archive.rows("reading_baseline_messages"):
        if archive.parents["messages"].get(row["message_id"]) != baseline_conversations.get(row["baseline_id"]):
            raise SystemArchiveError("Reading baseline crosses conversations.")


def restore_personal_features(db, archive, owner, target):
    if "user_features" not in archive.table_models:
        return
    subject = str(owner)
    get_or_create_preferences(db, subject)
    for row in sorted(archive.rows("user_features"), key=lambda item: item["collection"] == "saved-search"):
        value = dict(row["value"])
        for field, table in (("conversation_id", "conversations"), ("project_id", "projects"), ("tag_id", "user_features")):
            if value.get(field):
                value[field] = str(target(table, value[field]))
        if "conversation_ids" in value:
            value["conversation_ids"] = [str(target("conversations", item)) for item in value["conversation_ids"]]
        if "targets" in value:
            value["targets"] = [{**item, "id": str(target("projects" if item["scope"] == "project" else "conversations", item["id"]))} for item in value["targets"]]
        if row["collection"] == "conversation-tag":
            from app.services.user_feature_entries import _normalized_tag_name
            names = {_normalized_tag_name(entry.value["name"]) for entry in db.query(UserFeatureEntry).filter_by(subject_key=subject, collection="conversation-tag")}
            original, index = value["name"], 1
            while _normalized_tag_name(value["name"]) in names:
                index += 1
                value["name"] = original[:22] + f" (restored {index})"
        # Existing limits/conflict handling apply atomically; never silently drop data.
        write_entry(db, subject, row["collection"], target("user_features", row["id"]), 0, value, OwnershipScope(owner))
    for name in ("reading_baselines", "reading_baseline_messages"):
        for row in archive.rows(name):
            payload = _decode_payload(MODELS[name], row)
            payload["id"] = target(name, row["id"])
            if "subject_key" in payload:
                payload["subject_key"] = subject
            for field, table in (("conversation_id", "conversations"), ("message_id", "messages"), ("baseline_id", "reading_baselines")):
                if row.get(field):
                    payload[field] = target(table, row[field])
            db.add(MODELS[name](**payload))
        db.flush()


def restore_system_features(db, archive, owned):
    from app.services.exporting.system_archive import _restore_rows
    for name, model in MODELS.items():
        def rows():
            for payload in owned(archive.rows(name)):
                if payload.get("subject_key"):
                    get_or_create_preferences(db, payload["subject_key"])
                yield payload
        _restore_rows(db, model, rows())
