"""Read returned packages as untrusted data; retain only derived members."""
from dataclasses import dataclass
import json

from app.services.continuation_candidates import ContinuationError, checked_members
from app.services.context_protocol.canonical_v2 import select_adapter
from app.services.context_protocol.fingerprints import message_content_digest, message_locator_digest
from app.services.context_protocol.inspection import inspect_package
from app.services.context_protocol.manifest import load_package_manifest
from app.services.context_protocol.source import PackageSource


@dataclass(frozen=True)
class ReturnedContinuation:
    members: dict[str, bytes]
    comparison: dict


def _metadata(continuation):
    if not isinstance(continuation, dict):
        return None
    result = {key: continuation[key] for key in ('schema_version', 'continuation_revision', 'trust', 'current', 'index', 'raw_tail_start_seq')
              if key in continuation}
    for key in ('coverage', 'source_fingerprint'):
        value = continuation.get(key)
        if isinstance(value, dict):
            allowed = ('seq_start', 'seq_end', 'message_count') if key == 'coverage' else ('profile', 'algorithm', 'content', 'locators')
            result[key] = {field: value[field] for field in allowed if field in value}
            if key == 'coverage' and isinstance(value.get('source_fingerprint'), dict):
                result[key]['source_fingerprint'] = {field: value['source_fingerprint'][field]
                    for field in ('profile', 'algorithm', 'content', 'locators') if field in value['source_fingerprint']}
    return result


def _checked_source(source):
    manifest = load_package_manifest(source)
    adapter = select_adapter(source, manifest.entrypoint)
    snapshot = adapter.scan()
    if snapshot.parse_errors:
        raise ContinuationError('CONTEXT_RAW_INVALID')
    # Check every physical object even if its checksum is omitted from `files`.
    # Raw attachment declarations must describe the bytes that were returned.
    verified = {}
    missing = 0
    for attachment in snapshot.attachments.values():
        path = attachment.object_path
        if not path or not source.exists(path):
            missing += 1
            continue
        digest = verified.setdefault(path, None)
        if digest is None:
            digest = source.sha256(path)
            verified[path] = digest
        if attachment.object_sha256 != digest or (attachment.object_byte_size is not None and attachment.object_byte_size != source.byte_size(path)):
            raise ContinuationError('CONTEXT_ATTACHMENT_MISMATCH')
    messages = {}
    for message in adapter.iter_messages():
        seq = message.descriptor.sequence
        if seq in messages:
            raise ContinuationError('CONTEXT_RAW_INVALID')
        messages[seq] = (message_content_digest(message, snapshot), message_locator_digest(message, snapshot))
    return manifest, snapshot, messages, missing


def extract_returned_continuation(returned_path, canonical_path, conversation_id):
    """Compare caller-owned target Raw; identity is never an authorization check.

    Both paths are private temporary inputs. This function does not write storage,
    import Raw, run scripts, or adopt a revision. Source changes remain explicit.
    """
    try:
        inspection = inspect_package(str(returned_path), verify_hashes='all')
        if inspection.get('status') in {'invalid', 'ambiguous', 'unsupported'} or any(
            entry.get('severity') == 'error' for entry in inspection.get('anomalies', [])
        ):
            raise ContinuationError('CONTEXT_RETURN_INVALID')
        with PackageSource(returned_path) as returned, PackageSource(canonical_path) as canonical:
            manifest, snapshot, source_messages, missing = _checked_source(returned)
            _, _, target_messages, _ = _checked_source(canonical)
            source_id = manifest.conversation.get('id')
            header_id = (snapshot.header or {}).get('conversation', {}).get('id')
            if source_id != str(conversation_id) or (header_id is not None and header_id != source_id):
                raise ContinuationError('CONTEXT_IDENTITY_UNRESOLVED', 409)
            shared = source_messages.keys() & target_messages.keys()
            content_changes = sum(source_messages[seq][0] != target_messages[seq][0] for seq in shared)
            locator_changes = sum(source_messages[seq][1] != target_messages[seq][1] for seq in shared)
            source_only = source_messages.keys() - target_messages.keys()
            target_only = target_messages.keys() - source_messages.keys()
            relation = 'matching'
            if content_changes:
                relation = 'history_changed'
            elif source_only and target_only:
                relation = 'range_changed'
            elif source_only:
                relation = 'returned_tail_newer' if min(source_only) > max(target_messages, default=0) else 'range_changed'
            elif target_only:
                relation = 'canonical_tail_newer' if min(target_only) > max(source_messages, default=0) else 'range_changed'
            elif locator_changes:
                relation = 'locators_changed'
            members = {}
            continuation = manifest.continuation or {}
            for name, fallback, limit in (('current', 'continuation/current.md', 1024**2), ('index', 'continuation/index.json', 8 * 1024**2)):
                path = continuation.get(name, fallback)
                if not isinstance(path, str):
                    raise ContinuationError('CONTEXT_RETURN_INVALID')
                if returned.exists(path):
                    members[name] = returned.read_bytes(path, max_bytes=limit)
            if not members:
                raise ContinuationError('CONTEXT_NO_CONTINUATION')
            if 'current' in members and 'index' in members:
                from app.services.context_protocol.validation import validate_continuation
                source_validation = validate_continuation(str(returned_path))
                if source_validation.get('runtime_state') not in {'valid_verified', 'valid_provisional', 'unsupported_major'}:
                    raise ContinuationError('CONTEXT_RETURN_PAIR_INVALID', 409)
            metadata = {'conversation': {'id': source_id}}
            if manifest.continuation is not None:
                metadata['continuation'] = _metadata(manifest.continuation)
            members['manifest'] = json.dumps(metadata, ensure_ascii=False, separators=(',', ':')).encode()
            checked_members(members)
            return ReturnedContinuation(members, {'relation': relation, 'source_message_count': len(source_messages),
                'target_message_count': len(target_messages), 'changed_messages': content_changes,
                'changed_locators': locator_changes, 'source_only_messages': len(source_only),
                'target_only_messages': len(target_only), 'missing_source_attachments': missing})
    except ContinuationError:
        raise
    except Exception:
        # Parsing exceptions can contain filenames, source lines or private IDs.
        raise ContinuationError('CONTEXT_RETURN_INVALID') from None


def create_return_candidate(db, conversation_id, scope, returned_path, *, subject_key, base_generation, idempotency_key,
                            base_revision_id=None, progress_callback=None):
    from app.services.continuation_candidates import owned_conversation, create_candidate
    from app.services.context_snapshot import temporary_context_snapshot
    owned_conversation(db, conversation_id, scope)
    with temporary_context_snapshot(db, conversation_id, subject_key=subject_key, progress_callback=progress_callback) as (canonical, revision):
        extracted = extract_returned_continuation(returned_path, canonical, conversation_id)
    conversation = owned_conversation(db, conversation_id, scope, lock=True)
    if conversation.offline_revision != revision:
        raise ContinuationError('CONTEXT_SOURCE_CHANGED', 409)
    candidate = create_candidate(db, conversation_id, scope, members=extracted.members,
                                 base_generation=base_generation, base_revision_id=base_revision_id,
                                 idempotency_key=idempotency_key)
    return candidate, extracted.comparison


def extract_direct_files(path):
    """Extract only the user's Current/Index, with ZIP and file safety checks.

    No Raw snapshot is created, no fingerprints are compared and no continuation
    semantics are checked. Uploaded scripts and attachment bytes are never used.
    """
    from zipfile import BadZipFile
    from app.services.context_protocol.source import PackageError
    from app.services.context_protocol.safety import load_protocol_json
    from app.services.continuation_candidates import MEMBER_LIMITS
    try:
        with PackageSource(path) as source:
            if not source.exists('manifest.json') or not source.exists('conversation.canjsonl'):
                raise ContinuationError('CONTEXT_RETURN_INVALID')
            if not isinstance(load_protocol_json(source.read_text('manifest.json')), dict):
                raise ContinuationError('CONTEXT_RETURN_INVALID')
            members = {}
            for name, filename in (('current', 'current.md'), ('index', 'index.json')):
                member = 'continuation/' + filename
                if source.exists(member):
                    members[name] = source.read_bytes(member, max_bytes=MEMBER_LIMITS[name])
            return checked_members(members)
    except ContinuationError:
        raise
    except (PackageError, BadZipFile, OSError, ValueError, UnicodeError):
        raise ContinuationError('CONTEXT_RETURN_INVALID') from None
