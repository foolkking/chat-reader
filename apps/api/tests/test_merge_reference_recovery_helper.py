"""Synthetic merge-only recovery regressions; no external attachment reads."""
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, event, insert
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.canonical.block_builder import build_basic_render_blocks
from app.services.editing.merge_attachment_recovery import MergeAttachmentRecovery, recover_occurrences
from app.services.import_pipeline.canonical_draft import content_hash


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    event.listen(engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as session:
        yield session
        session.rollback()
    engine.dispose()


def _conversation(db):
    identity = uuid.uuid4()
    db.execute(insert(Conversation).values(
        id=identity, title="Synthetic", display_title="Synthetic", source_type="synthetic",
        source_profile="synthetic", parser_version="test", status="processing",
    ))
    return identity


def _attachment(db, conversation_id):
    identity = uuid.uuid4()
    db.execute(insert(Attachment).values(
        id=identity, conversation_id=conversation_id, original_filename="private-synthetic-name.bin",
        display_name="Private synthetic name", status="missing", resolution_status="missing",
        scan_status="not_available", metadata_={"synthetic_private_marker": "not-for-another-source"},
    ))
    return identity


def _version(db, conversation_id, text="Synthetic text", *, keep_blocks=True):
    message_id, version_id = uuid.uuid4(), uuid.uuid4()
    blocks = [{
        "block_index": index, "block_type": row.block_type, "plain_text": row.plain_text,
        "data": row.data, "char_count": row.char_count,
        "source_start": row.source_start, "source_end": row.source_end,
    } for index, row in enumerate(build_basic_render_blocks(text))]
    db.execute(insert(Message).values(
        id=message_id, conversation_id=conversation_id, role="assistant",
        order_key=str(message_id), current_version_id=version_id,
    ))
    db.execute(insert(MessageVersion).values(
        id=version_id, message_id=message_id, version_number=1, plain_text=text,
        display_text=text, blocks=blocks, edit_type="synthetic",
        content_hash=content_hash(text, "assistant"),
    ))
    if keep_blocks:
        for block in blocks:
            db.execute(insert(RenderBlock).values(
                id=uuid.uuid4(), message_version_id=version_id,
                **{k: v for k, v in block.items() if k not in {"source_start", "source_end"}},
            ))
    return version_id


def _link(db, version_id, attachment_id, *, block_index=0, key=None, ordinal=0):
    key = key or uuid.uuid4().hex
    db.execute(insert(MessageVersionAttachment).values(
        id=uuid.uuid4(), message_version_id=version_id, attachment_id=attachment_id,
        block_index=block_index, occurrence_key=key, display_order=ordinal,
        placement="inline", relation_type="file", display_mode="card",
        alt_text="Synthetic alt", caption="Synthetic caption",
    ))
    return key


def _links(db, version_id):
    return db.query(MessageVersionAttachment).filter_by(message_version_id=version_id).order_by(
        MessageVersionAttachment.display_order, MessageVersionAttachment.id,
    ).all()


def _prepare(db, template, *, keep_blocks=True):
    source_id, peer_id, target_id = (_conversation(db) for _ in range(3))
    original = _attachment(db, source_id)
    recovery = MergeAttachmentRecovery(target_id, {source_id: {}, peer_id: {}})
    recovery.ensure_references(db, source_id, {original})
    mapped = recovery.mapping_for(source_id)[original]
    source = _version(db, source_id)
    target = _version(db, target_id, template.replace("{id}", str(mapped)), keep_blocks=keep_blocks)
    return recovery, source_id, original, mapped, source, target


def _recover(db, source, target, mapping, recovery):
    return recover_occurrences(
        db, source_version_id=source, target_version_id=target,
        attachment_id_map=mapping, recovery=recovery,
    )


@pytest.mark.parametrize("template,existing", [
    ("Read [one](cr-asset://{id}) and [two](cr-asset://{id}).", 0),
    ("Read [one](cr-asset://{id}) and [two](cr-asset://{id}).", 1),
    ('<div><img src="cr-asset://{id}"><a href="cr-asset://{id}">again</a></div>', 0),
    ("[one][x] and [two][x]\n\n[x]: cr-asset://{id}", 0),
    ('合成正文\r\n<div><img src="cr-asset://{id}"><img src="cr-asset://{id}"></div>', 0),
    ("`[literal](cr-asset://{id})` [one](cr-asset://{id}) and [two](cr-asset://{id})", 0),
], ids=["markdown", "one-retained", "html", "reference-definition", "crlf-unicode", "literal-sibling"])
def test_missing_repeated_occurrences_are_recovered_by_actual_count(db, template, existing):
    recovery, scope, original, _mapped, source, target = _prepare(db, template)
    for index in range(existing):
        _link(db, source, original, ordinal=index, key=f"retained-{index}")
    body_before = db.get(MessageVersion, target).display_text
    hash_before = db.get(MessageVersion, target).content_hash
    assert _recover(db, source, target, recovery.mapping_for(scope), recovery) == 2
    rows = _links(db, target)
    assert len(rows) == 2 and all(row.block_index == 0 for row in rows)
    assert len({row.occurrence_key for row in rows}) == 2
    assert recovery.repaired_occurrences == 2 - existing
    assert recovery.unlocated_occurrences == 0
    for index in range(existing):
        assert any(row.occurrence_key == f"retained-{index}" for row in rows)
    assert db.get(MessageVersion, target).display_text == body_before
    assert db.get(MessageVersion, target).content_hash == hash_before


@pytest.mark.parametrize("template", [
    '`<img src="cr-asset://{id}">`',
    '```html\n<img src="cr-asset://{id}">\n```',
    '<pre>\n\n<img src="cr-asset://{id}">\n\n</pre>',
    '<code>\n\n<img src="cr-asset://{id}">\n\n</code>',
    '<!--\n\n<img src="cr-asset://{id}">\n\n-->',
    '\\<img src="cr-asset://{id}">',
    '''[example](https://example.invalid '<img src="cr-asset://{id}">')''',
], ids=["inline-code", "fenced", "pre", "code", "comment", "escaped", "markdown-title"])
def test_literal_examples_never_create_attachment_occurrences(db, template):
    recovery, scope, _original, _mapped, source, target = _prepare(db, template)
    assert _recover(db, source, target, recovery.mapping_for(scope), recovery) == 0
    assert _links(db, target) == []
    assert recovery.repaired_occurrences == recovery.unlocated_occurrences == 0


def test_same_id_real_sibling_does_not_activate_literal_projection(db):
    recovery, scope, _original, _mapped, source, target = _prepare(
        db, '<pre>\n\n<img src="cr-asset://{id}">\n\n</pre>\n\n<img src="cr-asset://{id}">',
    )
    assert _recover(db, source, target, recovery.mapping_for(scope), recovery) == 1
    assert _links(db, target)[0].block_index == 3
    assert recovery.repaired_occurrences == 1
    assert recovery.unlocated_occurrences == 0


def test_missing_placeholder_never_reads_foreign_metadata_and_ensure_is_idempotent(db):
    source_id, other_id, target_id = (_conversation(db) for _ in range(3))
    original = _attachment(db, other_id)
    recovery = MergeAttachmentRecovery(target_id, {source_id: {}, other_id: {}})
    statements = []

    def record(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(db.bind, "before_cursor_execute", record)
    try:
        recovery.ensure_references(db, source_id, {original})
        recovery.ensure_references(db, source_id, {original})
    finally:
        event.remove(db.bind, "before_cursor_execute", record)
    assert statements and all(statement.lstrip().upper().startswith("INSERT") for statement in statements)
    row = db.get(Attachment, recovery.mapping_for(source_id)[original])
    assert row.conversation_id == target_id
    assert row.asset_object_id is row.import_id is row.detected_mime_type is None
    assert row.status == row.resolution_status == "missing"
    assert row.scan_status == "not_available"
    assert row.original_filename == "missing-attachment.bin"
    assert row.display_name == "Unavailable attachment"
    assert "synthetic_private_marker" not in row.metadata_
    assert recovery.summary() == {
        "missing_attachments": 1, "repaired_occurrences": 0, "unlocated_occurrences": 0,
    }
    recovery.ensure_references(db, other_id, {original})
    assert recovery.mapping_for(source_id)[original] != recovery.mapping_for(other_id)[original]
    assert len(recovery.missing_attachment_ids) == 2
    for invalid_scope in (uuid.uuid4(), target_id):
        with pytest.raises(ValueError, match="not registered"):
            recovery.ensure_references(db, invalid_scope, {original})


def test_preserve_good_repeated_keys_order_and_presentation(db):
    recovery, scope, original, _mapped, source, target = _prepare(
        db, "Read [one](cr-asset://{id}) and [two](cr-asset://{id}).",
    )
    _link(db, source, original, key="first", ordinal=4)
    _link(db, source, original, key="second", ordinal=5)
    assert _recover(db, source, target, recovery.mapping_for(scope), recovery) == 2
    rows = _links(db, target)
    assert [(row.occurrence_key, row.display_order, row.block_index) for row in rows] == [
        ("first", 4, 0), ("second", 5, 0),
    ]
    assert all(row.alt_text == "Synthetic alt" and row.caption == "Synthetic caption" for row in rows)
    assert recovery.repaired_occurrences == recovery.unlocated_occurrences == 0


@pytest.mark.parametrize("ambiguous", [False, True], ids=["unique", "ambiguous"])
def test_invalid_old_block_only_relocates_when_unique(db, ambiguous):
    template = "[one](cr-asset://{id})" + ("\n\n[two](cr-asset://{id})" if ambiguous else "")
    recovery, scope, original, _mapped, source, target = _prepare(db, template)
    key = _link(db, source, original, block_index=77)
    assert _recover(db, source, target, recovery.mapping_for(scope), recovery) == (3 if ambiguous else 1)
    rows = _links(db, target)
    assert next(row for row in rows if row.occurrence_key == key).block_index == (None if ambiguous else 0)
    assert _links(db, source)[0].block_index == 77
    assert {row.block_index for row in rows} == ({None, 0, 1} if ambiguous else {0})
    assert recovery.repaired_occurrences == (2 if ambiguous else 1)
    assert recovery.unlocated_occurrences == int(ambiguous)


@pytest.mark.parametrize("existing", [False, True])
def test_no_real_block_produces_unlocated_link_not_fabricated_navigation(db, existing):
    recovery, scope, original, _mapped, source, target = _prepare(
        db, "[one](cr-asset://{id})", keep_blocks=False,
    )
    if existing:
        _link(db, source, original)
    assert _recover(db, source, target, recovery.mapping_for(scope), recovery) == 1
    assert _links(db, target)[0].block_index is None
    assert recovery.unlocated_occurrences == 1
    assert recovery.repaired_occurrences == int(not existing)
    assert db.query(RenderBlock).filter_by(message_version_id=target).count() == 0


@pytest.mark.parametrize("deleted", [False, True], ids=["foreign", "deleted"])
def test_target_attachment_must_be_owned_and_not_deleted(db, deleted):
    recovery, scope, _original, mapped, source, target = _prepare(db, "[one](cr-asset://{id})")
    row = db.get(Attachment, mapped)
    if deleted:
        row.deleted_at = datetime.now(timezone.utc)
    else:
        row.conversation_id = scope
    db.flush()
    with pytest.raises(ValueError, match="ownership"):
        _recover(db, source, target, recovery.mapping_for(scope), recovery)
    assert _links(db, target) == []


def test_wrong_source_mapping_and_source_as_target_rejected(db):
    recovery, scope, _original, _mapped, source, target = _prepare(db, "[one](cr-asset://{id})")
    with pytest.raises(ValueError, match="mapping"):
        _recover(db, source, target, {}, recovery)
    with pytest.raises(ValueError, match="target conversation"):
        _recover(db, source, source, recovery.mapping_for(scope), recovery)
    assert _links(db, target) == _links(db, source) == []


def test_accidental_helper_replay_does_not_duplicate_occurrences(db):
    recovery, scope, _original, _mapped, source, target = _prepare(db, "[one](cr-asset://{id})")
    assert _recover(db, source, target, recovery.mapping_for(scope), recovery) == 1
    with pytest.raises(ValueError, match="already has"):
        _recover(db, source, target, recovery.mapping_for(scope), recovery)
    assert len(_links(db, target)) == 1
    assert recovery.repaired_occurrences == 1


def test_missing_references_are_batched_not_capped(db):
    source_id, target_id = _conversation(db), _conversation(db)
    recovery = MergeAttachmentRecovery(target_id, {source_id: {}})
    identities = {uuid.uuid4() for _ in range(451)}
    recovery.ensure_references(db, source_id, identities)
    recovery.ensure_references(db, source_id, identities)
    assert len(recovery.mapping_for(source_id)) == len(recovery.missing_attachment_ids) == 451
    assert db.query(Attachment).filter_by(conversation_id=target_id).count() == 451


def test_unmatched_html_projection_is_not_silently_treated_as_success(db):
    recovery, scope, _original, mapped, source, target = _prepare(
        db, '<div><a href="cr-asset://{id}">File</a></div>',
    )
    block = db.query(RenderBlock).filter_by(message_version_id=target).one()
    block.data = {"text": f'Synthetic unmatched <img src="cr-asset://{mapped}">'}
    db.flush()
    with pytest.raises(ValueError, match="source context"):
        _recover(db, source, target, recovery.mapping_for(scope), recovery)
    assert _links(db, target) == []
    assert recovery.repaired_occurrences == recovery.unlocated_occurrences == 0
