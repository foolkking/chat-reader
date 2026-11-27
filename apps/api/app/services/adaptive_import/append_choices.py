"""Small, integrity-bound pages of choices. Reading the picker never re-opens a ZIP or a media blob."""
import hashlib
import json
import uuid
import zipfile
from collections import defaultdict
from pathlib import Path

from app.core.config import get_settings
from app.services.adaptive_import.archive_sources import _artifact_path, archive_catalog
from app.services.adaptive_import.reader_package import PROFILE, package_header
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.reader_preview import dialogue_preview

PAGE = 40
MAX_SELECTION = 250
MAX_RANGES = 4096
MAX_ORDINAL = 2**53 - 1
MAX_SELECTION_BYTES = 256 * 1024


def selection_ranges(indexes=None, *, ranges=None, selected_count=None, count=None):
    """Canonical half-open coordinates; limits bound encoding, not message count."""
    if ranges is None:
        if (not isinstance(indexes, list) or not indexes or len(indexes) > MAX_SELECTION
                or selected_count is not None or any(type(i) is not int for i in indexes)
                or len(set(indexes)) != len(indexes)):
            invalid()
        values = [[i, i + 1] for i in sorted(indexes)]
    else:
        if (indexes is not None or not isinstance(ranges, list) or not ranges or len(ranges) > MAX_RANGES
                or type(selected_count) is not int or selected_count <= 0):
            invalid()
        values = ranges
    normalized, total, previous = [], 0, -1
    for pair in values:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            invalid()
        start, end = pair
        if (type(start) is not int or type(end) is not int or not 0 <= start < end <= MAX_ORDINAL
                or start < previous or count is not None and end > count):
            invalid()
        total += end - start
        if normalized and start == previous:
            normalized[-1][1] = end
        else:
            normalized.append([start, end])
        previous = end
    if ranges is not None and total != selected_count:
        invalid()
    return normalized


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()).hexdigest()


def invalid():
    raise AdaptiveImportError("APPEND_SOURCE_CHANGED", "The source changed. Review it again.", layer="validation")


def directory(record):
    base = Path(get_settings().import_storage_dir).resolve()
    folder = (base / str(record.id)).resolve()
    if folder.parent != base or not folder.is_dir():
        invalid()
    return folder


def grouped(rows, kind=None):
    by_id = defaultdict(list)
    for r in rows:
        if isinstance(r, dict) and (kind is None or r.get("record_type") == kind):
            by_id[str(r.get("message_id", ""))].append(r)
    return by_id


class Units:
    """Only access the chosen record(s); old versions, notes and annotations are not selected."""
    def __init__(self, draft):
        self.draft = draft
        self.assets = {str(r["id"]): r for r in draft.attachments if r.get("record_type") == "attachment"}
        self.links = grouped(draft.attachments, "attachment_ref")
        self.refs = grouped(draft.source_refs)

    def get(self, index):
        message = self.draft.messages[index]
        key = str(message.source_message_id or "")
        unit = self.draft.stream_records[index] if self.draft.stream_records is not None else {}
        refs = unit.get("source_refs", self.refs.get(key, []))
        links = [r for r in unit.get("attachments", self.links.get(key, []))
                 if r.get("record_type") == "attachment_ref" and str(r.get("message_id")) == key
                 and (not r.get("message_version_id") or r["message_version_id"] == message.source_current_version_id)]
        if any(str(r["attachment_id"]) not in self.assets for r in links):
            invalid()
        return message, refs, links


def write_choices(record, group, draft, ordinal, group_ordinal):
    """Called inside the worker's existing admission, after attachment enrichment, before READY."""
    root = directory(record)
    generation = uuid.uuid4().hex
    pages, page = [], []
    units = Units(draft)
    artifacts = {str(a.id): a for a in record.artifacts}
    originals = []
    missing = set()
    header = None
    for id_ in group.artifact_ids:
        a = artifacts[str(id_)]
        meta = a.parsed_summary or {}
        parent = artifacts.get(str(meta.get("archive_artifact_id"))) if meta.get("archive_artifact_id") else None
        originals.append([parent.sha256 if parent else a.sha256, meta.get("archive_path") if parent else None])
        if parent:
            catalog = archive_catalog(record, parent.id)
            missing.update(str(m["member_id"]) for m in catalog["members"] if m.get("availability") == "missing")
            if catalog.get("reader_profile") == PROFILE:
                with zipfile.ZipFile(_artifact_path(record, parent)) as z:
                    header = package_header(z)
    if (record.analysis_summary or {}).get("append_only", {}).get("device") and not header:
        invalid()
    source = digest(["chatgpt", header["source_id"]]) if header else digest(["file", originals, group_ordinal])
    question = None

    def flush():
        raw = json.dumps(page, ensure_ascii=False, separators=(",", ":")).encode()
        with (root / f"choices-{generation}-{len(pages)}.json").open("xb") as out:
            out.write(raw)
        pages.append(hashlib.sha256(raw).hexdigest())
        page.clear()

    for index in range(len(draft.messages)):
        msg, refs, links = units.get(index)
        if header:
            ref = next((r for r in refs if r.get("source_profile") == PROFILE
                        and r.get("source_conversation_id") == header["source_id"]
                        and r.get("source_message_id") == msg.source_message_id), None)
            if not ref or not ref["source_metadata"].get("item_digest"):
                invalid()
            native = msg.source_message_id
            signature = ref["source_metadata"]["item_digest"]
            full_fingerprint = ref["source_metadata"].get("fingerprint")
        else:
            native, full_fingerprint = None, None
            # Original bytes and member path bind file identity. Normalize uploader-generated
            # attachment IDs so a second upload of the same actual file remains recognizable.
            text = msg.display_text
            for aid in {str(link["attachment_id"]) for link in links}:
                a = units.assets[aid]
                text = text.replace("cr-asset://" + aid, "archive-member:" + str(
                    a.get("metadata", {}).get("archive_path") or a.get("original_filename") or aid))
            signature = digest([msg.role, text])
        item = digest(["id", native] if native else ["index", index])
        # A partial list must not imply that the previous selected question is the actual
        # parent of an answer. For excerpts the host supplies no invented parent edges.
        if msg.role == "user":
            question = item
        relationship = question
        if header and header["lineage"] == "list":
            selected_question = ref["source_metadata"].get("selected_question")
            relationship = digest(["id", selected_question]) if selected_question is not None else None
        linked = {str(link["attachment_id"]) for link in links}
        loss = sum(a in missing or not units.assets[a].get("metadata", {}).get("archive_artifact_id") for a in linked)
        page.append({"index": index, "role": msg.role, "text": dialogue_preview(msg.display_text[:1024], msg.role, empty=""),
                     "turn": msg.turn_index, "assets": len(linked), "missing": loss, "item": item,
                     "question": relationship,
                     "signature": signature, "native": native, "fingerprint": full_fingerprint})
        if len(page) == PAGE:
            flush()
    if page:
        flush()
    return {"generation": generation, "ordinal": ordinal, "title": draft.display_title or draft.title,
            "count": len(draft.messages), "source": source, "chat": header["source_id"] if header else None,
            "source_partial": bool(header and header["partial"]), "pages": pages}


def book(record, ordinal):
    books = (record.draft_summary or {}).get("append_choices") or []
    if ordinal < 0 or ordinal >= len(books):
        invalid()
    return books[ordinal]


def read_page(record, source, page):
    hashes = source["pages"]
    if page < 0 or page >= len(hashes):
        return []
    generation = uuid.UUID(hex=source["generation"]).hex
    path = directory(record) / f"choices-{generation}-{page}.json"
    if path.is_symlink() or not path.is_file() or path.stat().st_size > PAGE * 4096:
        invalid()
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != hashes[page]:
        invalid()
    return json.loads(raw)


def selected(record, source, indexes=None, *, ranges=None, selected_count=None):
    intervals = selection_ranges(indexes, ranges=ranges, selected_count=selected_count, count=source["count"])
    group, rows = -1, []
    for start, end in intervals:
        for i in range(start, end):
            if i // PAGE != group:
                group = i // PAGE
                rows = read_page(record, source, group)
            if i % PAGE >= len(rows):
                invalid()
            row = rows[i % PAGE]
            if row["index"] != i:
                invalid()
            yield row
