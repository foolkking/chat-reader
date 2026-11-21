"""Bounded reader for immutable, server-created v1 canonical JSONL drafts.

Do not give the old whole-conversation json.loads reader a smaller reserve.
Instead validate every record first, index message spans on disk, then reuse
the v2 per-message canonical writer. Unsupported private-content/header shapes
return to the original guarded reader BEFORE any canonical write.
"""
from collections.abc import Sequence
from contextlib import contextmanager
from dataclasses import fields
import hashlib
import json
from pathlib import Path
import re
import struct
import tempfile

from app.services.adaptive_import.bounded_io import checkpoint, release_file_cache
from app.services.adaptive_import.memory_budget import bounded_unit_admission
from app.services.adaptive_import.stream_markdown import decode_message
from app.services.import_pipeline.canonical_draft import CanonicalDraftConversation
from app.services.import_pipeline.record_spool import MappedSequence, RecordSpool

UNIT_BYTES = 2 * 1024 * 1024
HEADER_BYTES = 64 * 1024
_SPAN = struct.Struct("<QQ32s")
_TOKENS = re.compile(rb'["\\{}\[\]]')
_WS = b" \r\n\t"


class NotUnitCompatible(Exception):
    """Not an error waiver: the unchanged materializing guard must still pass."""


class Scanner:
    def __init__(self, source):
        self.source = source
        self.buffer = b""
        self.offset = self.base = 0
        self.digest = hashlib.sha256()

    def fill(self):
        if self.offset == len(self.buffer):
            self.base += len(self.buffer)
            self.buffer = self.source.read(65536)
            self.offset = 0
            self.digest.update(self.buffer)
            if self.base % (1024 * 1024) == 0:
                release_file_cache(self.source)
            checkpoint()
        return self.buffer[self.offset:self.offset + 1]

    def position(self):
        return self.base + self.offset

    def whitespace(self):
        while self.fill() and self.buffer[self.offset] in _WS:
            self.offset += 1

    def expect(self, byte):
        self.whitespace()
        if self.fill() != byte:
            raise ValueError("Invalid canonical draft structure.")
        self.offset += 1

    def value(self, maximum):
        self.whitespace()
        first = self.fill()
        if not first:
            raise ValueError("Truncated canonical draft.")
        start = self.position()
        pieces, size = [], 0
        stack = []
        in_string = escaped = False
        compound = first in (b"{", b"[", b'"')
        finished = False
        while not finished:
            if not self.fill():
                if compound:
                    raise ValueError("Truncated canonical draft.")
                break
            begin = self.offset
            if compound:
                for match in _TOKENS.finditer(self.buffer, begin):
                    pos, token = match.start(), match[0]
                    if escaped:
                        # A backslash only escapes the immediately next byte.
                        if pos == self.offset:
                            escaped = False
                            self.offset = pos + 1
                            continue
                        escaped = False
                    if in_string:
                        if token == b"\\":
                            escaped = True
                        elif token == b'"':
                            in_string = False
                            if not stack:
                                finished = True
                    elif token == b'"':
                        in_string = True
                    elif token in (b"{", b"["):
                        stack.append(token)
                        if len(stack) > 64:
                            raise NotUnitCompatible()
                    elif token in (b"}", b"]"):
                        if not stack or stack.pop() != (b"{" if token == b"}" else b"["):
                            raise ValueError("Invalid canonical draft structure.")
                        finished = not stack
                    else:
                        raise ValueError("Invalid canonical draft escape.")
                    self.offset = pos + 1
                    if finished:
                        break
                if not finished:
                    # If the escaped byte was ordinary text after the last
                    # token, do not carry that escape into the next chunk.
                    if escaped and self.offset < len(self.buffer):
                        escaped = False
                    self.offset = len(self.buffer)
            else:
                while self.offset < len(self.buffer):
                    if self.buffer[self.offset] in b",]} \r\n\t":
                        finished = True
                        break
                    self.offset += 1
            piece = self.buffer[begin:self.offset]
            size += len(piece)
            if size > maximum:
                raise NotUnitCompatible()
            pieces.append(piece)
        raw = b"".join(pieces)
        checkpoint()
        value = json.loads(raw)
        return value, (start, size, hashlib.sha256(raw).digest())


class IndexedMessages(Sequence):
    """Disk offsets, never a Python list of all message text or offsets."""
    def __init__(self, source, index, start, count):
        self.source, self.index, self.start, self.count = source, index, start, count

    def __len__(self):
        return self.count

    @staticmethod
    def read(source, descriptor):
        offset, size, digest = _SPAN.unpack(descriptor)
        if not 0 < size <= UNIT_BYTES:
            raise ValueError("Invalid message span.")
        source.seek(offset)
        raw = source.read(size)
        if len(raw) != size or hashlib.sha256(raw).digest() != digest:
            raise ValueError("Import draft changed.")
        checkpoint()
        return {"message": json.loads(raw)}

    def __iter__(self):
        with self.source.open("rb") as source, self.index.open("rb") as offsets:
            offsets.seek(self.start * _SPAN.size)
            for _ in range(self.count):
                yield self.read(source, offsets.read(_SPAN.size))
                release_file_cache(source)
                checkpoint()

    def __getitem__(self, index):
        if isinstance(index, slice):
            return [self[i] for i in range(*index.indices(self.count))]
        if index < 0:
            index += self.count
        if not 0 <= index < self.count:
            raise IndexError(index)
        with self.source.open("rb") as source, self.index.open("rb") as offsets:
            offsets.seek((self.start + index) * _SPAN.size)
            return self.read(source, offsets.read(_SPAN.size))


@contextmanager
def indexed_drafts(path, record, db, maximum):
    """Qualify the whole immutable file before exposing even the first draft."""
    from app.services.import_pipeline.draft_store import ImportDraftError
    allowed = {f.name for f in fields(CanonicalDraftConversation)} - {"stream_records"}
    total = {"conversations": 0, "messages": 0}
    # No copied bodies, migration or mutation of an existing reviewed draft.
    with bounded_unit_admission(db, record, stage="commit"), tempfile.TemporaryDirectory(
        prefix=".commit-units-", dir=path.parent,
    ) as temporary:
        directory = Path(temporary)
        index = directory / "messages.idx"
        with path.open("rb") as source, index.open("xb") as offsets:
            scanner = Scanner(source)

            def headers():
                scanner.whitespace()
                while scanner.fill():
                    beginning = scanner.position()
                    scanner.expect(b"{")
                    header, seen = {}, set()
                    first = total["messages"]
                    header_size = 0
                    while True:
                        key, _ = scanner.value(256)
                        if not isinstance(key, str) or key not in allowed or key in seen:
                            raise ValueError("Invalid canonical draft field.")
                        seen.add(key)
                        scanner.expect(b":")
                        if key == "messages":
                            scanner.expect(b"[")
                            scanner.whitespace()
                            if scanner.fill() != b"]":
                                while True:
                                    raw, span = scanner.value(UNIT_BYTES)
                                    decode_message(raw)  # Validate the actual constructor, no synthetic defaults.
                                    offsets.write(_SPAN.pack(*span))
                                    total["messages"] += 1
                                    del raw
                                    scanner.whitespace()
                                    if scanner.fill() == b"]":
                                        break
                                    scanner.expect(b",")
                            scanner.expect(b"]")
                        else:
                            raw, span = scanner.value(HEADER_BYTES)
                            header_size += span[1]
                            if header_size > HEADER_BYTES:
                                raise NotUnitCompatible()
                            # Their cross-message relations require the original
                            # writer. Never silently discard any private content.
                            if key in {"annotations", "notebooks", "attachments", "source_refs"} and raw != []:
                                raise NotUnitCompatible()
                            header[key] = raw
                        if scanner.position() - beginning > maximum:
                            raise ImportDraftError("Import draft exceeds the configured size limit.")
                        scanner.whitespace()
                        if scanner.fill() == b"}":
                            scanner.expect(b"}")
                            break
                        scanner.expect(b",")
                    count = total["messages"] - first
                    if "messages" not in seen or header.get("message_count") != count:
                        raise ValueError("Import draft message count does not match preview.")
                    CanonicalDraftConversation(**header, messages=[])
                    total["conversations"] += 1
                    yield {"header": header, "start": first, "count": count}
                    scanner.whitespace()

            spool = RecordSpool.write(directory, headers(), prefix="headers")
            offsets.flush()
            if scanner.digest.hexdigest() != record.draft_sha256:
                raise ImportDraftError("Import draft integrity check failed.")
            expected = record.draft_summary or {}
            for key, actual in (("conversation_count", total["conversations"]), ("message_count", total["messages"])):
                if int(expected.get(key) or 0) != actual:
                    raise ImportDraftError("Import draft count does not match preview.")

        def drafts():
            for item in spool:
                records = IndexedMessages(path, index, item["start"], item["count"])
                yield CanonicalDraftConversation(**item["header"], stream_records=records,
                    messages=MappedSequence(records, lambda raw: decode_message(raw["message"])))

        yield drafts()
