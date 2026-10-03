"""Read-only two-package comparison; semantic maintenance remains external."""
from itertools import zip_longest
from types import SimpleNamespace

from _context_package.source import PackageSource
from _context_package.manifest import load_package_manifest
from _context_package.canonical_v2 import select_adapter
from _context_package.fingerprints import canonical_json_bytes, message_content_projection, message_locator_projection
from .model import MaintenanceError
from .model import sha256_bytes


def member_inventory(source):
    return {name: {'sha256': source.sha256(name), 'byte_size': source.byte_size(name)}
            for name in sorted(source.list_members())}


def inventory_digest(inventory):
    return sha256_bytes(canonical_json_bytes({'profile': 'context-package-members-v1', 'members': inventory}))


def _snapshot(source):
    manifest = load_package_manifest(source)
    for path, item in manifest.files.items():
        if not source.exists(path):
            raise MaintenanceError('A declared package member is missing', 'package_integrity_failure')
        if item.get('byte_size') is not None and source.byte_size(path) != item['byte_size']:
            raise MaintenanceError('A package member size differs', 'package_integrity_failure')
        if item.get('sha256') and source.sha256(path) != item['sha256']:
            raise MaintenanceError('A package member checksum differs', 'package_integrity_failure')
    adapter = select_adapter(source, manifest.entrypoint)
    snapshot = adapter.scan()
    if not snapshot.supported or snapshot.parse_errors:
        raise MaintenanceError('Raw records could not be parsed', 'raw_unverifiable')
    raw_conversation = (snapshot.header or {}).get('conversation')
    if raw_conversation is not None and not isinstance(raw_conversation, dict):
        raise MaintenanceError('Raw Conversation identity is malformed', 'raw_unverifiable')
    raw_identity = (raw_conversation or {}).get('id')
    if raw_identity and raw_identity != manifest.conversation.get('id'):
        raise MaintenanceError('Raw and manifest Conversation identities differ', 'lineage_unconfirmed')
    sequences = [message.sequence for message in snapshot.messages]
    if len(set(sequences)) != len(sequences) or sequences != sorted(sequences):
        raise MaintenanceError('Raw message sequences are ambiguous', 'raw_unverifiable')
    for field in ('message_id', 'version_id'):
        ids = [getattr(message, field) for message in snapshot.messages if getattr(message, field)]
        if len(ids) != len(set(ids)):
            raise MaintenanceError('Raw message/version identities are ambiguous', 'raw_unverifiable')
    for attachment in snapshot.attachments.values():
        if attachment.object_path and source.exists(attachment.object_path):
            if attachment.object_sha256 and source.sha256(attachment.object_path) != attachment.object_sha256:
                raise MaintenanceError('Attachment bytes disagree with Raw metadata', 'package_integrity_failure')
    refs = {}
    for ref in snapshot.attachment_refs:
        refs.setdefault(ref.message_id, []).append(ref)
    return manifest, adapter, snapshot, refs


def compare_packages(previous_package, new_raw_package):
    """Compare every message once; report boundaries without asserting semantics."""
    with PackageSource(previous_package) as old, PackageSource(new_raw_package) as new:
        om, oa, os, orefs = _snapshot(old)
        nm, na, ns, nrefs = _snapshot(new)
        identity = om.conversation.get('id')
        if not identity or identity != nm.conversation.get('id'):
            raise MaintenanceError('Packages do not establish the same Conversation identity', 'lineage_unconfirmed')
        prefix = 0
        prefix_last_seq = None
        first_change = None
        first_locator_change = None
        appended_start = None
        old_count = new_count = 0
        prefix_open = True
        for before, after in zip_longest(oa.iter_messages(), na.iter_messages()):
            old_count += before is not None
            new_count += after is not None
            if before is None:
                if appended_start is None:
                    appended_start = after.descriptor.sequence
                continue
            if after is None:
                if first_change is None:
                    first_change = before.descriptor.sequence
                prefix_open = False
                continue
            bs = SimpleNamespace(attachments=os.attachments, attachment_refs=orefs.get(before.descriptor.message_id, []))
            ats = SimpleNamespace(attachments=ns.attachments, attachment_refs=nrefs.get(after.descriptor.message_id, []))
            same = canonical_json_bytes(message_content_projection(before, bs)) == canonical_json_bytes(message_content_projection(after, ats))
            if not same:
                prefix_open = False
                if first_change is None:
                    first_change = after.descriptor.sequence
            if prefix_open:
                prefix += 1
                prefix_last_seq = after.descriptor.sequence
            if first_locator_change is None and canonical_json_bytes(message_locator_projection(before, bs)) != canonical_json_bytes(message_locator_projection(after, ats)):
                first_locator_change = after.descriptor.sequence
        old_assets = {p: old.sha256(p) for p in old.list_members() if p.startswith('assets/')}
        new_assets = {p: new.sha256(p) for p in new.list_members() if p.startswith('assets/')}
        changed_assets = sum(new_assets.get(p) != digest for p, digest in old_assets.items())
        state = 'history_changed' if first_change is not None else 'locator_changed' if first_locator_change is not None else 'append_only' if new_count > old_count else 'unchanged'
        return {
            'report_schema': 'chat-reader-context-update-comparison', 'report_version': '1.0.0',
            'state': state, 'identity_match': True,
            'previous_raw_sha256': old.sha256(om.entrypoint), 'new_raw_sha256': new.sha256(nm.entrypoint),
            'previous_snapshot_sha256': inventory_digest(member_inventory(old)),
            'new_snapshot_sha256': inventory_digest(member_inventory(new)),
            'previous_message_count': old_count, 'new_message_count': new_count,
            'unchanged_prefix_message_count': prefix, 'first_changed_seq': first_change,
            'unchanged_prefix_last_seq': prefix_last_seq,
            'first_locator_changed_seq': first_locator_change, 'new_tail_start_seq': appended_start,
            'changed_or_missing_previous_assets': changed_assets,
            'previous_continuation_present': bool(om.continuation),
            'supplementary_context_review_required': True,
            'semantic_reuse_verified': False,
            'next_action': 'Review prior continuation validity and supplementary context; repair from the earliest affected semantic boundary before materialization.',
        }
