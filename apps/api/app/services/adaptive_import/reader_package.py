"""Reader's opt-in ZIP contract. Byte ranges, not translated headings, delimit messages."""
import hashlib
import json
import re
import uuid
import zipfile
from dataclasses import replace
from datetime import datetime

from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.import_pipeline.canonical_draft import CanonicalDraftMessage, content_hash, preview_text
from app.core.config import get_settings

PROFILE = "reader-chat-v1"
INDEX = "reader/source.jsonl"
CHUNK = 256 * 1024
ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
HEX = re.compile(r"[0-9a-f]{64}\Z")


def require(ok):
    if not ok:
        raise AdaptiveImportError("READER_PACKAGE_INVALID", "The Reader package does not match its source index.", layer="archive")


def _reject_constant(_value):
    raise ValueError("Non-JSON metadata number.")


def _json(data):
    try:
        obj = json.loads(data, parse_constant=_reject_constant)
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise AdaptiveImportError("READER_PACKAGE_INVALID", "Invalid Reader package metadata.", layer="archive") from exc
    require(isinstance(obj, dict))
    return obj


def package_header(z):
    info = z.getinfo("manifest.json")
    require(info.file_size <= min(4 * 1024 * 1024, get_settings().bundle_max_object_bytes))
    m = _json(z.read(info))
    require(set(m) == {"version","source_id","title","lineage","messages","assets","partial"})
    require(m["version"] == PROFILE and isinstance(m["source_id"], str) and ID.fullmatch(m["source_id"]))
    require(isinstance(m["title"], str) and 0 < len(m["title"]) <= 512 and "\n" not in m["title"] and "\r" not in m["title"])
    require(m["lineage"] in ("tree", "list") and m["messages"] == [] and type(m["partial"]) is bool)
    require(isinstance(m["assets"], list) and len(m["assets"]) + 3 <= get_settings().bundle_max_entries)
    paths = set()
    for asset in m["assets"]:
        require(isinstance(asset, dict) and set(asset) == {"path","kind","root"})
        path = asset["path"]
        require(isinstance(path, str) and re.fullmatch(r"assets/[\w.-]{1,200}", path) and path not in paths
                and isinstance(asset["root"], str) and HEX.fullmatch(asset["root"])
                and asset["kind"] in ("image", "file"))
        paths.add(path)
    require(len(z.infolist()) == len(paths) + 3 and set(z.namelist()) == paths | {"conversation.md", INDEX, "manifest.json"})
    return m


def verify_assets(z, m):
    from app.services.adaptive_import.bounded_io import checkpoint
    for a in m["assets"]:
        chain = bytes(32)
        with z.open(a["path"]) as stream:
            while part := stream.read(CHUNK):
                checkpoint()
                chain = hashlib.sha256(chain + part).digest()
        require(chain.hex() == a["root"])


def index_rows(source):
    """Parse JSONL metadata in bounded chunks, never an archive-sized readline.

    The existing metadata scalar/depth and archive-byte guards still apply.
    Message bodies and message counts are not limited here; array growth visits
    the live workspace/control checkpoint every 64 KiB of input.
    """
    from app.services.adaptive_import.manifest_stream import _Reader
    from app.services.uploads import UploadLimitError

    class IndexReader(_Reader):
        whitespace_pattern = re.compile(r"[ \t\r]*")

    reader = IndexReader(source, max_bytes=get_settings().bundle_max_object_bytes)
    try:
        while reader.peek():
            # json.loads(bytes) accepted a UTF-8 BOM at the start of each row.
            if reader.peek() == "\ufeff":
                reader.take()
            end = reader.buffer.find("\n", reader.offset)
            if end >= 0:
                # Most rows fit in the already-bounded input buffer. Preserve
                # json.loads' fast path without ever reading a whole large row.
                row = _json(reader.buffer[reader.offset:end])
                reader.offset = end + 1
                yield row
                continue
            reader.whitespace()
            require(reader.peek() == "{")
            row = reader.value(keep=True)
            reader.whitespace()
            require(reader.take() == "\n")
            yield row
    except (UnicodeError, ValueError, RecursionError) as exc:
        if isinstance(exc, (AdaptiveImportError, UploadLimitError)):
            raise
        raise AdaptiveImportError("READER_PACKAGE_INVALID", "Invalid Reader package metadata.", layer="archive") from exc


def messages(z, m):
    """Consumes Markdown and JSONL in lockstep; never inflate the entire archive/text."""
    from app.services.adaptive_import.bounded_io import checkpoint
    from app.services.import_pipeline.record_spool import TextIntegrityError, read_verified_text
    roots = {a["path"]: a["root"] for a in m["assets"]}
    seen, tree_nodes, used, previous, last_user = set(), set(), set(), None, None
    with z.open("conversation.md") as md, z.open(INDEX) as idx:
        header = f"# {m['title']}\n\n".encode()
        require(md.read(len(header)) == header)
        for row in index_rows(idx):
            checkpoint()
            fields = {"id","parent","source_path","role","offset","bytes","sha256","assets","at"}
            require(isinstance(row, dict) and set(row) in (fields, fields | {"question"}))
            key, role, n = row["id"], row["role"], row["bytes"]
            require(isinstance(key, str) and ID.fullmatch(key) and key not in seen and role in ("user","assistant"))
            if "question" in row:
                # Excerpts may refer only to an already disclosed, selected question, never to an omitted row.
                require(m["lineage"] == "list" and role == "assistant" and last_user is not None
                        and row["question"] == last_user)
            if role == "user":
                last_user = key
            require(row["parent"] == (previous if m["lineage"] == "tree" else None))
            segment = row["source_path"]
            require(isinstance(segment, list) and (bool(segment) if m["lineage"] == "tree" else not segment))
            for node in segment:
                require(isinstance(node, str) and ID.fullmatch(node) and node not in tree_nodes)
                tree_nodes.add(node)
            require(type(n) is int and 0 < n <= z.getinfo("conversation.md").file_size - md.tell())
            at = row["at"]
            if at is not None:
                require(isinstance(at, str) and len(at) <= 40)
                try:
                    require(datetime.fromisoformat(at).tzinfo is not None)
                except ValueError:
                    require(False)
            prefix = f"## {role.capitalize()}\n\n".encode()
            require(md.read(len(prefix)) == prefix and type(row["offset"]) is int and md.tell() == row["offset"])
            try:
                body = read_verified_text(md, n, row["sha256"])
            except (TextIntegrityError, UnicodeError):
                require(False)
            require(md.read(2) == b"\n\n")
            assets = row["assets"]
            require(isinstance(assets, list) and len(assets) <= len(roots)
                    and all(isinstance(p, str) and p in roots for p in assets) and len(set(assets)) == len(assets))
            used.update(assets)
            seen.add(key)
            previous = key
            from app.services.adaptive_import.archive_sources import archive_reference_matches
            # Do not adopt direct Reader asset IDs supplied as source Markdown.
            refs = [match["target"] for match in archive_reference_matches(body)]
            require(not any(r.startswith(("cr-asset:", "cr-archive-member:")) for r in refs))
            require({r for r in refs if r.startswith("assets/")} == set(assets))
            fingerprint = json.dumps([key,row["parent"],segment,role,at,row["sha256"],[(p,roots[p]) for p in assets]],
                                     ensure_ascii=False, separators=(",",":")).encode()
            yield row, body, hashlib.sha256(fingerprint).hexdigest()
        require(seen and not md.read(1) and used == set(roots))


def analyze_index(path):
    """Recognition is based on explicit byte-index authority, never role headings inside prose/code."""
    from app.services.adaptive_import.analysis import ANALYZER_VERSION, signature_digest
    from app.services.adaptive_import.contracts import AnalysisResult
    with zipfile.ZipFile(path) as archive:
        package_header(archive)
    signature = {"version": ANALYZER_VERSION, "mode": "MARKDOWN", "builtin": PROFILE}
    return AnalysisResult(mode="MARKDOWN", signature=signature, signature_digest=signature_digest(signature),
        mapping_candidates={"boundaries": [], "suggested": {
            "title": "FIRST_H1_OR_FILENAME", "boundary": {"kind": "HEADING", "level": 2},
            "role_mapping": {"User": "user", "Assistant": "assistant"}, "preamble": "IGNORE",
        }}, semantic={}, handling_class="SUPPORTED")


def indexed_draft(record, source, template, catalog):
    from app.services.adaptive_import.archive_sources import _artifact_path, _rewrite_document_references
    from app.services.adaptive_import.stream_markdown import decode_message
    from app.services.adaptive_import.memory_budget import streaming_budget
    from app.services.import_pipeline.record_spool import MappedSequence, RecordSpool
    artifact = next(a for a in record.artifacts if str(a.id) == str(catalog["artifact_id"]))
    path = _artifact_path(record, artifact)
    members = {m["member_id"]: m for m in catalog["members"]}
    first = None
    turns = 0
    with zipfile.ZipFile(path) as z:
        meta = package_header(z)
        verify_assets(z, meta)
        asset_roots = {item["path"]: item["root"] for item in meta["assets"]}

        def rows():
            nonlocal first, turns
            for i, (row, text, fingerprint) in enumerate(messages(z, meta)):
                role, key = row["role"], row["id"]
                body = _rewrite_document_references(text, "conversation.md", members)
                if role == "user":
                    turns += 1
                    if first is None:
                        first = preview_text(body)
                message = CanonicalDraftMessage(role=role, order_key=f"{i+1:08d}", turn_index=max(0, turns-1),
                    created_at=row["at"], plain_text=body, display_text=body, content_hash=content_hash(body, role),
                    source_json_index=None, source_markdown_index=i, display_source="markdown",
                    source_message_id=key, source_current_version_id=key+":1")
                ref = {"message_id": key, "source_message_id": key, "source_index": i, "source_type":"chatgpt",
                       "source_profile":PROFILE, "source_conversation_id":meta["source_id"],
                       "source_metadata":{"parent":row["parent"], "tree_nodes":row["source_path"], "fingerprint":fingerprint}}
                if "question" in row:
                    ref["source_metadata"]["selected_question"] = row["question"]
                # An explicitly selected excerpt does not claim the intervening tree edges.
                # This content identity is independent of its neighbors and of Reader asset UUIDs.
                ref["source_metadata"]["item_digest"] = hashlib.sha256(json.dumps(
                    [role, row["sha256"], [(p, asset_roots[p]) for p in row["assets"]]],
                    ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
                yield {"message":message, "source_refs":[ref]}
        if streaming_budget():
            spool = RecordSpool.write(path.parent, rows(), prefix="reader-source", spill_text=True)
            sequence, refs = MappedSequence(spool, lambda r: decode_message(r["message"])), []
        else:
            data = list(rows())
            spool, sequence, refs = None, [r["message"] for r in data], [r["source_refs"][0] for r in data]
    return replace(template, title=meta["title"], display_title=meta["title"], external_source_id=meta["source_id"],
        messages=sequence, stream_records=spool, source_refs=refs, first_user_message=first,
        attachments=[], message_count=len(sequence), turn_count=turns, prompt_count=turns, response_count=len(sequence)-turns)
