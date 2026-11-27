"""Append to the current end, never reconcile a source tree back into old Reader messages."""
import hashlib
import hmac
import re
import uuid
from contextlib import closing
from dataclasses import replace
from datetime import datetime, timezone
from itertools import islice

from fastapi import HTTPException
from sqlalchemy import func, or_, select

from app.core.config import get_settings
from app.models.append_item import AppendItem
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.message import Message, STANDALONE_ANSWER
from app.models.message_version import MessageVersion
from app.models.reader_extension import ExtensionDevice
from app.models.share import Share
from app.models.source_message_ref import SourceMessageRef
from app.services.adaptive_import import append_choices as choices
from app.services.adaptive_import.reader_package import PROFILE
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.feature_policies import get_feature_policy
from app.services.reader_preview import dialogue_preview


class _TailMoved(Exception):
    """The candidate tail moved while acquiring the source/target lock pair."""


def submitted_decision(summary):
    # v0.1.10 cannot read ranges. If it explicitly reconfirms indexes after a
    # downgrade, its newer write leaves the unknown range key untouched.
    summary = summary or {}
    return summary.get("append_decision") or summary.get("append_range_decision") or {}


def with_submitted_decision(summary, decision):
    out = dict(summary or {})
    out.pop("append_decision", None)
    out.pop("append_range_decision", None)
    out["append_range_decision" if "ranges" in decision else "append_decision"] = decision
    return out


def _last_message(cid):
    return select(Message.id).where(Message.conversation_id == cid, Message.is_deleted.is_(False)
                                    ).order_by(Message.order_key.desc()).limit(1)


def authorize(db, record, *, lock=False):
    mode = (record.analysis_summary or {}).get("append_only")
    if not mode or not record.owner_user_id:
        raise HTTPException(404)
    if not get_feature_policy(db).allow_user_import:
        raise HTTPException(403, "Import is disabled.")
    if device := mode.get("device"):
        from app.services.extension_access import alive, principal_for
        q = select(ExtensionDevice).where(ExtensionDevice.id == uuid.UUID(device))
        grant = db.scalar(q.with_for_update() if lock else q)
        user = principal_for(db, grant)
        if (not get_settings().reader_extension_capture or user.id != record.owner_user_id
                or not alive(grant.expires_at, datetime.now(timezone.utc))):
            raise HTTPException(403, "Import authorization expired.")
    return mode


def target_for(db, record, cid, *, lock=False):
    mode = authorize(db, record, lock=lock)
    if mode.get("target") and mode["target"] != str(cid):
        raise HTTPException(404)
    q = select(Conversation).where(Conversation.id == cid, Conversation.owner_user_id == record.owner_user_id,
                                   Conversation.deleted_at.is_(None))
    if lock:
        # Source edits lock Message before updating Conversation. Taking these
        # locks in the opposite order would deadlock against replace_current.
        if db.scalar(q.with_only_columns(Conversation.id)) is None:
            raise HTTPException(404)
        tail = db.scalar(_last_message(cid).with_for_update(of=Message, key_share=True))
    target = db.scalar((q.with_for_update() if lock else q).execution_options(populate_existing=True))
    if target is None:
        raise HTTPException(404)
    if target.status != "active":
        raise HTTPException(409, {"code": "APPEND_TARGET_READ_ONLY"})
    if lock and db.scalar(_last_message(cid)) != tail:
        # Another appender/structural edit may have installed a different tail.
        # Never lock that new message after Conversation: return a fresh review,
        # and require a new confirmation rather than reversing the lock order.
        raise _TailMoved()
    return target


def tail_state(db, target, *, lock=False):
    from app.services.sharing.share_service import share_settings_revision
    # content_hash is maintained by both edit paths, but normalizes whitespace
    # (including Markdown hard breaks). Bind exact display_text as well. On PG
    # the digest stays in the database: a long tail is not loaded into the API.
    body = (func.encode(func.sha256(func.convert_to(MessageVersion.display_text, "UTF8")), "hex")
            if db.get_bind().dialect.name == "postgresql" else MessageVersion.display_text)
    q = select(Message.id, Message.current_version_id, Message.order_key, Message.role,
               func.substr(MessageVersion.plain_text, 1, 1024).label("brief"),
               MessageVersion.content_hash, body.label("body_revision")).outerjoin(
        MessageVersion, MessageVersion.id == Message.current_version_id).where(
        Message.conversation_id == target.id, Message.is_deleted.is_(False)).order_by(Message.order_key.desc()).limit(1)
    # This is deliberately a separate statement AFTER the Message lock. A
    # joined locking SELECT can see the pre-wait version row under READ COMMITTED.
    last = db.execute(q).first()
    shares = select(Share).where(Share.conversation_id == target.id, Share.scope == "conversation",
            Share.content_mode == "live", Share.revoked_at.is_(None),
            or_(Share.expires_at.is_(None), Share.expires_at > datetime.now(timezone.utc))).order_by(Share.id)
    scope = [share_settings_revision(s) for s in db.scalars(shares.with_for_update() if lock else shares)]
    title = target.display_title or target.title
    exact = last.body_revision if last else None
    if last and exact is not None and db.get_bind().dialect.name != "postgresql":
        exact = hashlib.sha256(exact.encode("utf-8")).hexdigest()
    revision = choices.digest([str(target.id), title,
        [*[str(v) for v in last[:3]], last.role, last.content_hash, exact] if last else None, scope])
    return ({"title": title, "tail": {"role": last.role, "text": dialogue_preview(last.brief or "", last.role, empty="")} if last else None,
             "live_share": bool(scope)}, revision)


def _classified(db, record, cid, source, selection):
    """One page of source and duplicate flags, even for millions of selections."""
    coordinates = selection if isinstance(selection, dict) else {"indexes": selection}
    selected = iter(choices.selected(record, source, **coordinates))
    while rows := list(islice(selected, choices.PAGE)):
        by_item = {r["item"]: r for r in rows}
        seen, unchanged = set(), set()
        for item, signature in db.execute(select(AppendItem.item_key, AppendItem.signature).where(
                AppendItem.conversation_id == cid, AppendItem.source_key == source["source"],
                AppendItem.item_key.in_(by_item)).execution_options(yield_per=choices.PAGE)):
            seen.add(item)
            if signature == by_item[item]["signature"]:
                unchanged.add(item)
        if source["chat"]:
            by_native = {r["native"]: r for r in rows}
            for native, signature, fingerprint in db.execute(select(SourceMessageRef.source_message_id,
                    SourceMessageRef.raw_metadata["item_digest"].as_string(),
                    SourceMessageRef.raw_metadata["fingerprint"].as_string())
                    .join(Message, SourceMessageRef.message_id == Message.id).where(
                        Message.conversation_id == cid, SourceMessageRef.source_type == "chatgpt",
                        SourceMessageRef.source_profile == PROFILE, SourceMessageRef.source_conversation_id == source["chat"],
                        SourceMessageRef.source_message_id.in_(by_native)).execution_options(yield_per=choices.PAGE)):
                row = by_native[native]
                seen.add(row["item"])
                if signature == row["signature"] or row["fingerprint"] and fingerprint == row["fingerprint"]:
                    unchanged.add(row["item"])
        for row in rows:
            yield row, row["item"] in unchanged, row["item"] in seen
        from app.services.adaptive_import.bounded_io import checkpoint
        checkpoint()


def review(db, record, cid, volume, indexes=None, *, ranges=None, selected_count=None, lock=False):
    coordinates = {"indexes": indexes} if ranges is None else {"ranges": ranges, "selected_count": selected_count}
    try:
        target = target_for(db, record, cid, lock=lock)
    except _TailMoved:
        current = review(db, record, cid, volume, **coordinates)[0]
        raise HTTPException(409, {"code": "APPEND_REVIEW_CHANGED", "review": current}) from None
    source = choices.book(record, volume)
    intervals = choices.selection_ranges(**coordinates, count=source["count"])
    all_digest, fresh_digest = hashlib.sha256(), hashlib.sha256()
    total = added = changed = missing = 0
    for row, duplicate, known in _classified(db, record, cid, source, coordinates):
        total += 1
        all_digest.update(bytes.fromhex(choices.digest([row["index"], row["signature"]])))
        if duplicate:
            continue
        added += 1
        changed += int(known)
        missing += row["missing"]
        fresh_digest.update(bytes.fromhex(choices.digest(row["index"])))
    state, revision = tail_state(db, target, lock=lock)
    proof = choices.digest([str(record.owner_user_id), str(record.id), str(cid), volume, record.draft_sha256,
        source["generation"], intervals, total, all_digest.hexdigest(), fresh_digest.hexdigest(),
        changed, missing, revision, source["source_partial"]])
    receipt = hmac.new(get_settings().auth_secret_value().encode(), ("tail-v2:"+proof).encode(),
                       hashlib.sha256).hexdigest()
    # Reiterate the immutable, digest-checked pages under the same transaction.
    fresh = (row for row, duplicate, _ in _classified(db, record, cid, source, coordinates) if not duplicate)
    return ({**state, "receipt": receipt, "add": added, "skip": total-added, "changed": changed,
             "missing": missing, "partial": bool(source["source_partial"] or missing)}, target, source, fresh)


def consent(info, decision):
    return (hmac.compare_digest(info["receipt"], decision["receipt"]) and
            (not info["add"] or (not info["live_share"] or decision["allow_share"])
             and (not info["partial"] or decision["allow_partial"]) and (not info["changed"] or decision["allow_changed"])))


def next_key(previous):
    if not previous:
        return "00000001"
    if len(previous) > 110 or not re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", previous):
        raise ValueError("The existing order cannot be safely extended.")
    whole, dot, frac = previous.partition(".")
    n = int(whole) + (1_000_000 if dot and len(whole) >= 12 else 1)
    if len(str(n)) <= len(whole):
        return str(n).zfill(len(whole)) + (dot + "0"*len(frac) if dot else "")
    # At an integer-width boundary keep numeric *and* lexicographic order.
    if dot and int(frac) + 1 < 10**len(frac):
        return whole + "." + str(int(frac)+1).zfill(len(frac))
    return previous + ("" if dot else ".") + "000001"


def persist(db, record, progress):
    from app.services.adaptive_import.memory_budget import import_analysis_admission
    # Keep the existing resource policy through final hashing and index rebuild,
    # not just while the draft iterator happens to be open.
    with import_analysis_admission(db, record, stage="commit"):
        result = _persist(db, record, progress)
    # Admission's final checkpoint can still reject the work. It must precede
    # the sole canonical commit, including the import receipt and derived rows.
    db.commit()
    return result


def _persist(db, record, progress):
    from app.services.canonical import persistence as cp
    from app.services.canonical.stream_persistence import _persist_one, conversation_hash
    from app.services.adaptive_import.archive_sources import verify_archive_sources
    from app.services.adaptive_import.bounded_io import file_hash
    from app.services.import_pipeline.draft_store import iter_import_draft
    from app.services.conversation_revision import bump_offline_revision
    from app.services.search.search_indexer import rebuild_search_and_toc_for_conversation
    from app.services.adaptive_import.append_scratch import attachment_ids
    decision = submitted_decision(record.analysis_summary)
    if not decision:
        raise cp.CommitImportError("A reviewed selection is required.")
    cid = uuid.UUID(decision["target"])
    coordinates = {k: decision[k] for k in ("indexes", "ranges", "selected_count") if k in decision}
    try:
        info, target, source, fresh = review(db, record, cid, decision["volume"], **coordinates, lock=True)
    except HTTPException as exc:
        if exc.status_code == 409 and isinstance(exc.detail, dict) and exc.detail.get("code") in {
            "APPEND_REVIEW_CHANGED", "APPEND_TARGET_READ_ONLY",
        }:
            raise AdaptiveImportError("APPEND_REVIEW_CHANGED", "Review the current destination again.", layer="commit") from exc
        raise
    if not consent(info, decision):
        raise AdaptiveImportError("APPEND_REVIEW_CHANGED", "Review the current destination again.", layer="commit")
    # Both old and new durable draft formats, including small non-streaming uploads.
    directory = choices.directory(record)
    path = (directory.parent / record.draft_storage_uri).resolve()
    if path.parent != directory or file_hash(path) != record.draft_sha256:
        raise AdaptiveImportError("SOURCE_CHANGED", "The staged source changed; no messages were appended.", layer="commit")
    verified = set()
    verify_archive_sources(record, verified)
    # Renumbering an existing row, even a deleted row, is not an append.
    previous = db.scalar(select(func.max(Message.order_key)).where(Message.conversation_id == cid,
                      ~Message.order_key.like("deleted-%"))) or ""
    turns = target.turn_count
    preceding_standalone = db.scalar(select(Message.author_label).where(
        Message.conversation_id == cid, Message.is_deleted.is_(False)).order_by(Message.order_key.desc()).limit(1)) == STANDALONE_ANSWER
    last_question = db.scalar(select(Message.id).where(Message.conversation_id == cid, Message.is_deleted.is_(False),
                   Message.role == "user").order_by(Message.order_key.desc()).limit(1))
    here = {}
    if last_question and info["add"]:
        for key in db.scalars(select(AppendItem.item_key).where(AppendItem.conversation_id == cid,
                    AppendItem.source_key == source["source"], AppendItem.message_id == last_question)):
            here[key] = last_question
        if source["chat"]:
            for native in db.scalars(select(SourceMessageRef.source_message_id).where(SourceMessageRef.message_id == last_question,
                    SourceMessageRef.source_profile == PROFILE, SourceMessageRef.source_conversation_id == source["chat"])):
                here[choices.digest(["id", native])] = last_question
    if info["add"]:
        with attachment_ids(directory) as assets, closing(iter_import_draft(record, db=db)) as drafts:
            for volume, draft in enumerate(drafts):
                if volume != decision["volume"]:
                    continue
                units = choices.Units(draft)
                done = 0
                for done, row in enumerate(fresh, 1):
                    msg, _, links = units.get(row["index"])
                    key = msg.source_message_id or f"selected-{row['index']}"
                    version = msg.source_current_version_id or key+":1"
                    previous = next_key(previous)
                    orphan = msg.role == "assistant" and (
                        not row["question"] or not last_question or here.get(row["question"]) != last_question)
                    if msg.role == "user" or orphan or preceding_standalone:
                        turns += 1
                    preceding_standalone = bool(orphan)
                    # Only the *reviewed current* body becomes version 1 of a NEW message.
                    msg = replace(msg, source_message_id=key, source_current_version_id=version, versions=[],
                                  order_key=previous, turn_index=max(0, turns-1))
                    chosen_assets = list(dict.fromkeys(str(r["attachment_id"]) for r in links))
                    new_assets = [units.assets[a] for a in chosen_assets if a not in assets]
                    child = cp._from_exporter_draft(replace(draft, messages=[msg], stream_records=None, attachments=new_assets,
                                                source_refs=[], annotations=[], notebooks=[]))
                    assets.update(cp._persist_canjson_attachments(db, record, target, child, verified_archives=verified))
                    converted = cp._rewrite_persistable_attachment_ids(child.messages, {a: assets[a] for a in chosen_assets})[0]
                    identity = _persist_one(db, target, converted)
                    mid = identity[key][0]
                    if msg.role == "user":
                        last_question = mid
                        here = {row["item"]: mid}
                        if not target.first_user_message:
                            target.first_user_message = msg.plain_text[:2000]
                    elif orphan:
                        db.query(Message).filter(Message.id == mid).update({"author_label": STANDALONE_ANSWER}, synchronize_session=False)
                    cp._persist_canjson_attachment_refs(db, replace(child, attachments=links), identity,
                                                        {a: assets[a] for a in chosen_assets})
                    db.add(AppendItem(conversation_id=cid, source_key=source["source"], item_key=row["item"],
                                      signature=row["signature"], message_id=mid))
                    db.flush()
                    cp._report(progress, "persisting", 10 + round(65*done/info["add"]), done, info["add"])
                if done != info["add"]:
                    raise cp.CommitImportError("The selected source changed; review it again.")
                break
            else:
                raise cp.CommitImportError("The selected source is unavailable.")
        target.message_count += info["add"]
        target.turn_count = turns
        target.updated_at = target.sort_time = datetime.now(timezone.utc)
        target.content_hash = conversation_hash(db.execute(select(MessageVersion.plain_text).join(Message,
            Message.current_version_id == MessageVersion.id).where(Message.conversation_id == cid, Message.is_deleted.is_(False))
            .order_by(Message.order_key).execution_options(yield_per=8)))
        bump_offline_revision(target)
        db.flush()
        rebuild_search_and_toc_for_conversation(db, cid)
    result = {"target": str(cid), "added": info["add"], "skipped": info["skip"], "partial": info["partial"] and bool(info["add"])}
    db.add(ConversationEvent(conversation_id=cid, event_type="messages_appended", created_by="import",
                             payload={"added": info["add"], "skipped": info["skip"], "import_id": str(record.id)}))
    record.analysis_summary = {**record.analysis_summary, "append_result": result}
    record.conversation_id = cid
    record.status, record.phase, record.session_state = "committed", "completed", "COMPLETED"
    record.progress, record.processed_messages, record.total_messages = 100, info["add"], info["add"]
    record.completed_at = record.committed_at = record.heartbeat_at = datetime.now(timezone.utc)
    record.error_message = None
    return cp.CommitImportResult(record.id, "committed", [cid], 1, info["add"])
