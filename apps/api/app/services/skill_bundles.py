"""Skill files are opaque data. This service never imports or executes a member."""
from __future__ import annotations

import hashlib
import io
import json
import re
import stat
import unicodedata
import zipfile
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.administration import SystemSkill
from app.models.skill_bundle import SkillBundleMember, SkillBundleRevision, SkillFileObject
from app.models.user_skill import UserSkill
from app.services.assets.asset_store import get_asset_store

MAX_UPLOAD = 16 * 1024 * 1024
MAX_EXPANDED = 32 * 1024 * 1024
MAX_MEMBER = 8 * 1024 * 1024
MAX_MEMBERS = 256


@dataclass(frozen=True)
class Bundle:
    root: str
    members: dict[str, bytes]
    source_kind: str = "BUNDLE"

    @property
    def content(self):
        path = 'references/legacy-instructions.md' if self.source_kind == 'LEGACY_MARKDOWN' else 'SKILL.md'
        return self.members[path].decode('utf-8')

    @property
    def digest(self):
        manifest = [(p, hashlib.sha256(data).hexdigest()) for p, data in sorted(self.members.items())]
        return hashlib.sha256(json.dumps([self.root, manifest], separators=(',', ':')).encode()).hexdigest()


def _text(data: bytes) -> str:
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError as exc:
        raise ValueError('Skill file must be UTF-8 text.') from exc
    if not text.strip():
        raise ValueError('Skill file must not be empty.')
    if any(c not in '\t\n\r' and unicodedata.category(c) == 'Cc' for c in text):
        raise ValueError('Skill file must be plain UTF-8 text.')
    if len(data) > 512 * 1024:
        raise ValueError('SKILL.md exceeds 512 KiB.')
    return text


def legacy_bundle(content: str) -> Bundle:
    _text(content.encode('utf-8'))
    wrapper = ('---\nname: personal-skill\ndescription: User-provided legacy Skill instructions.\n---\n\n'
               'Read references/legacy-instructions.md for the original user Skill. '
               'This compatibility wrapper does not certify Context protocol conformance.\n')
    return Bundle('personal-skill', {'SKILL.md': wrapper.encode(),
                  'references/legacy-instructions.md': content.encode('utf-8')}, 'LEGACY_MARKDOWN')


def parse_bundle(data: bytes, filename: str) -> Bundle:
    try:
        return _parse_bundle(data, filename)
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, OSError) as exc:
        raise ValueError('Skill Bundle could not be read safely.') from exc


def _parse_bundle(data: bytes, filename: str, *, max_upload: int = MAX_UPLOAD) -> Bundle:
    if filename.lower().endswith('.md'):
        return legacy_bundle(_text(data))
    if not filename.lower().endswith('.zip'):
        raise ValueError('Only Skill Bundle (.zip) or legacy Markdown (.md) files are supported.')
    if len(data) > max_upload:
        raise ValueError('Skill Bundle exceeds 16 MiB.')
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError('Invalid Skill Bundle ZIP.') from exc
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_MEMBERS or sum(i.file_size for i in infos) > MAX_EXPANDED:
            raise ValueError('Skill Bundle exceeds expanded size or member limits.')
        members, seen, roots = {}, set(), set()
        file_paths = {unicodedata.normalize('NFC', info.filename.rstrip('/')).casefold()
                      for info in infos if not info.is_dir()}
        reserved = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}
        for info in infos:
            name = info.filename.rstrip('/')
            parts = name.split('/')
            if (not name or '\\' in name or len(name) > 240 or any(
                not p or p in {'.', '..'} or p.endswith(('.', ' ')) or p.split('.')[0].upper() in reserved
                or any(ord(c) < 32 or c in ':<>"|?*' for c in p) for p in parts)):
                raise ValueError('Unsafe Skill Bundle member path.')
            path_key = unicodedata.normalize('NFC', name).casefold()
            if path_key in seen or info.flag_bits & 1 or stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError('Duplicate, encrypted or linked Skill Bundle member.')
            key_parts = path_key.split('/')
            if any('/'.join(key_parts[:i]) in file_paths for i in range(1, len(key_parts))):
                raise ValueError('Skill Bundle has a file/directory collision.')
            seen.add(path_key)
            roots.add(parts[0])
            if info.is_dir():
                continue
            if len(parts) < 2 or info.file_size > MAX_MEMBER:
                raise ValueError('Skill Bundle requires one root directory and bounded members.')
            with archive.open(info) as stream:
                body = stream.read(MAX_MEMBER + 1)
            if len(body) != info.file_size or len(body) > MAX_MEMBER:
                raise ValueError('Skill Bundle member size mismatch.')
            members['/'.join(parts[1:])] = body
        if len(roots) != 1 or 'SKILL.md' not in members:
            raise ValueError('Skill Bundle requires one root containing SKILL.md.')
        root = next(iter(roots))
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,99}', root):
            raise ValueError('Skill directory name must use lowercase letters, numbers and hyphens.')
        text = _text(members['SKILL.md'])
        if not text.startswith('---\n') and not text.startswith('---\r\n'):
            raise ValueError('SKILL.md requires name and description frontmatter.')
        front = re.split(r'^---\s*$', text, maxsplit=2, flags=re.MULTILINE)
        if len(front) != 3 or not re.search(r'^name:\s*[\w-]+\s*$', front[1], re.MULTILINE) or not re.search(r'^description:\s*\S', front[1], re.MULTILINE):
            raise ValueError('SKILL.md requires name and description frontmatter.')
        declared = re.search(r'^name:\s*([\w-]+)\s*$', front[1], re.MULTILINE).group(1)
        if declared != root:
            raise ValueError('Skill root directory must match its declared name.')
        return Bundle(root, members)


def revision_query(db: Session, item):
    field = SkillBundleRevision.user_skill_id if isinstance(item, UserSkill) else SkillBundleRevision.system_skill_id
    return db.query(SkillBundleRevision).filter(field == item.id)


def _object(db, data):
    digest = hashlib.sha256(data).hexdigest()
    obj = db.query(SkillFileObject).filter_by(sha256=digest).with_for_update(read=True, key_share=True).one_or_none()
    if obj is not None:
        read_member(obj)
        return obj
    store = get_asset_store()
    # Keep Skill members outside the attachment-object cleanup namespace.
    key = 'skills/' + store.object_key()
    try:
        with db.begin_nested():
            obj = SkillFileObject(sha256=digest, storage_key=key, byte_size=len(data))
            db.add(obj)
            db.flush()
    except IntegrityError:
        obj = db.query(SkillFileObject).filter_by(sha256=digest).one()
        read_member(obj)
        return obj
    staged = store.stage(io.BytesIO(data), max_bytes=MAX_MEMBER)
    try:
        store.promote(staged.path, key)
    finally:
        staged.path.unlink(missing_ok=True)
    from app.services.exporting.archive_transaction import track_archive_object
    track_archive_object(db, store, key)
    return obj


def save_revision(db, item, bundle: Bundle, *, base_revision: int, preserve_baseline: bool = True):
    """Caller owns authorization; row lock provides a serial replacement boundary."""
    db.query(type(item)).filter(type(item).id == item.id).with_for_update().populate_existing().one()
    latest = revision_query(db, item).order_by(SkillBundleRevision.revision.desc()).first()
    if latest and latest.digest == bundle.digest and item.bundle_revision == latest.revision:
        return latest
    if item.bundle_revision != base_revision:
        raise RuntimeError('Skill changed; reload and compare before replacing it.')
    if not latest and item.content and base_revision == 0 and preserve_baseline:
        _save(db, item, legacy_bundle(item.content), 1)
        latest = revision_query(db, item).order_by(SkillBundleRevision.revision.desc()).first()
        if latest.digest == bundle.digest:
            return latest
    number = (latest.revision if latest else 0) + 1
    return _save(db, item, bundle, number)


def _save(db, item, bundle, number):
    row = SkillBundleRevision(
        user_skill_id=item.id if isinstance(item, UserSkill) else None,
        system_skill_id=item.id if isinstance(item, SystemSkill) else None,
        revision=number, digest=bundle.digest, root_name=bundle.root,
        source_kind=bundle.source_kind, byte_size=sum(map(len, bundle.members.values())))
    db.add(row)
    db.flush()
    for path, data in bundle.members.items():
        obj = _object(db, data)
        db.add(SkillBundleMember(revision_id=row.id, path=path, object_sha256=obj.sha256))
    item.bundle_revision = number
    item.content = bundle.content
    # Existing content APIs remain a Markdown projection, never ZIP binary.
    item.byte_size = len(bundle.content.encode('utf-8'))
    item.content_digest = hashlib.sha256(bundle.content.encode('utf-8')).hexdigest()
    if isinstance(item, UserSkill):
        item.bundle_digest = bundle.digest if bundle.source_kind == 'BUNDLE' else None
    db.flush()
    return row


def member_rows(db, revision):
    return db.query(SkillBundleMember, SkillFileObject).join(
        SkillFileObject, SkillFileObject.sha256 == SkillBundleMember.object_sha256
    ).filter(SkillBundleMember.revision_id == revision.id).order_by(SkillBundleMember.path).all()


def read_member(obj):
    data = get_asset_store().resolve_key(obj.storage_key).read_bytes()
    if len(data) != obj.byte_size or hashlib.sha256(data).hexdigest() != obj.sha256:
        raise ValueError('Stored Skill member failed integrity validation.')
    return data


def download_revision(db, revision):
    return encode_bundle(Bundle(revision.root_name, {member.path: read_member(obj) for member, obj in member_rows(db, revision)}))


def encode_bundle(bundle: Bundle) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path, data in sorted(bundle.members.items()):
            info = zipfile.ZipInfo(f'{bundle.root}/{path}', (2026, 10, 2, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return output.getvalue()


def bundle_disposition(name: str) -> str:
    """Preserve the display name in ZIP downloads using RFC 5987 Unicode encoding."""
    from urllib.parse import quote
    safe = ''.join(c for c in name if c not in '/\\' and ord(c) >= 32).strip()
    stem = re.sub(r'\.(?:md|zip)$', '', safe, flags=re.I) or 'skill'
    return 'attachment; filename="skill.zip"; filename*=UTF-8\'\'' + quote(stem + '.zip', safe='')
