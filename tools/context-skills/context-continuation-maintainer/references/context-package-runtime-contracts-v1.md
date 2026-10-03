# Context Package Runtime Contracts v1

**Status:** frozen implementation contract for `context-acquisition` v1  
**Scope:** deterministic scripts and shared `_context_package/` runtime only.  
**Semantic authority:** `continuation-schema-v1.md` remains the continuation protocol; this file defines implementation APIs, not new continuation semantics.

## 1. Public scripts

The Skill exposes exactly three deterministic command-line utilities:

```text
scripts/inspect_context_package.py
scripts/validate_continuation.py
scripts/extract_context_ranges.py
```

They are read-only with respect to the source Context Package.

```text
inspect  = what source exists?
validate = can persisted continuation still bind safely to that source?
extract  = deliver exactly the source material selected by the Reader.
```

No script claims semantic model reading.

---

## 2. Shared runtime package

```text
scripts/_context_package/
├── __init__.py
├── model.py
├── safety.py
├── source.py
├── manifest.py
├── canonical_v2.py
├── fingerprints.py
├── current_doc.py
├── continuation_index.py
├── inspection.py
├── validation.py
└── extraction.py
```

The shared runtime is an implementation detail. The three public scripts are the supported external CLI surface.

---

## 3. Core data model

### `PackageSource`

Read-only abstraction over either:

- a `.zip` Context Package; or
- an extracted package directory.

Required operations:

```text
exists(relative_path)
open_binary(relative_path)
read_bytes(relative_path)
read_text(relative_path)
byte_size(relative_path)
sha256(relative_path)
copy_member(relative_path, destination)
list_members()
```

Package-root discovery MUST resolve exactly one `manifest.json`. Multiple candidate roots are ambiguous.

ZIP members MUST never be blindly extracted. Absolute paths, drive paths, and `..` traversal are unsafe.

### `PackageManifestInfo`

Normalized deterministic view of `manifest.json`:

```text
format
format_version
entrypoint
entrypoint_source
conversation
conversation_completeness
asset_completeness
attachments
included_content
files
continuation
```

`manifest.entrypoint` is authoritative when present. Legacy fallback to `conversation.canjsonl` is allowed only when the declared entrypoint is absent and that file exists.

### `CanonicalMessageDescriptor`

Compact source descriptor:

```text
sequence
ordinal
raw line
role
message_id?
version_id?
version_number?
order_key?
turn_index?
created_at?
body_available
body_empty
body_chars
body_utf8_bytes
exporter_content_hash?
attachment_ref_count
```

`ordinal` is Canonical Conversation order. Sequence arithmetic MUST NOT replace ordinal ordering.

### `CanonicalMessage`

A descriptor plus the complete accessible message payload:

```text
descriptor
body_text?
representation
ordered content_parts
```

Extraction may transport a large body in multiple byte-preserving parts, but those transport parts do not create multiple semantic messages.

### Attachment model

Keep three distinct identities:

```text
AttachmentDescriptor = logical attachment
AttachmentRefDescriptor = message/version -> attachment relation
physical object = package bytes identified by object path/digest
```

Logical attachment count, reference count, and physical-object count are not interchangeable.

### `StreamSnapshot`

Deterministic metadata snapshot of the canonical stream:

```text
stream format/version/support
header/end records
CanonicalMessageDescriptor[]
AttachmentDescriptor map
AttachmentRefDescriptor[]
SourceRefDescriptor[]
record counts
unknown additive record types
parse errors
```

The snapshot does not prove semantic traversal.

### `CurrentDocument`

Parsed deterministic subset of `current.md`:

```text
frontmatter
raw body
stable object IDs
explicit typed references
Evidence raw locators
duplicate IDs
```

Only explicit structured fields are machine references. The validator MUST NOT infer a reference edge merely because prose mentions an ID.

---

## 4. Canonical stream adapters

### Production adapter

V1 supports:

```text
format: chat-reader-canonical-jsonl
version: 2
```

Known record types:

```text
manifest
message
source_ref
attachment
attachment_ref
end
```

Unknown additive records are retained as counts/warnings and do not automatically invalidate the stream.

For a v2 message, `current_version.content_markdown` is the accessible current message body.

A source that does not provide a supported current-version projection MUST NOT be guessed into a canonical current-message view.

### Executable-fixture adapter

The conformance suite additionally supports a compact message-only JSONL form:

```json
{"sequence":1,"role":"user","content":[{"type":"text","text":"..."}]}
```

This adapter exists to run deterministic EX-43/EX-49 regression fixtures. It does not replace the production v2 adapter.

---

## 5. Fingerprint API

All continuation hashing uses shared `fingerprints.py`. Maintainer and Validator MUST reuse this implementation rather than copy the algorithm.

### Text canonicalization

For fingerprint projection only:

```text
CRLF -> LF
CR   -> LF
all other whitespace preserved
Unicode preserved
ordered content parts preserved
```

Extraction output does not apply this normalization.

### Canonical JSON

Use deterministic UTF-8 JSON with sorted object keys and compact separators for the v1 safe subset used by the conformance fixtures.

### Message semantic projection

```json
{
  "role": "user",
  "content": [/* ordered semantic content parts */]
}
```

Role participates in the digest.

For canonical-v2 messages, the Markdown body is represented as a text part. Message-linked attachment object digests participate as ordered attachment parts when available.

### Locator projection

```json
{
  "sequence": 59,
  "message_id": "... if available ...",
  "version_id": "... if available ...",
  "attachment_locators": ["... if any ..."]
}
```

Unavailable locators are omitted rather than invented.

### Domains

```text
chat-reader-continuation-prefix-content-v1
chat-reader-continuation-prefix-locators-v1
chat-reader-continuation-segment-content-v1
chat-reader-continuation-segment-locators-v1
```

Composition:

```text
sha256( UTF8(domain + "\n" + newline_joined_child_digest_hex) )
```

EX-49 is the executable oracle for CRLF handling, role inclusion, content-part ordering, attachment digest inclusion, and domain separation.

---

## 6. Inspector API

Python API:

```python
inspect_package(path, verify_hashes="core", detail="summary") -> dict
```

CLI:

```text
inspect_context_package.py PACKAGE
  [--pretty]
  [--output PATH]
  [--verify-hashes none|core|all]
  [--detail summary|index]
```

Machine report schema:

```text
chat-reader-package-inspection@1.0.0
```

Inspection status:

```text
ok
degraded
invalid
unsupported
ambiguous
```

The Inspector inventories source facts. It does not output acquisition mode, semantic trust, or Working Context.

---

## 7. Validator API

Python API:

```python
validate_continuation(path, detail="summary") -> dict
```

CLI:

```text
validate_continuation.py PACKAGE
  [--detail summary|full]
  [--pretty]
  [--output PATH]
```

Machine report schema:

```text
chat-reader-continuation-validation@1.0.0
```

Finite runtime states:

```text
valid_verified
valid_provisional
locator_only_mismatch
content_mismatch
pair_identity_mismatch
coverage_mismatch
unsupported_major
current_only
index_only
no_continuation
invalid
```

The Validator performs deterministic V0-V5 validation. V6 semantic review is reported as `not_performed` rather than faked.

A persisted `verified` pair is inheritance-eligible only when deterministic runtime binding to the unchanged Stable Prefix passes.

`locator_only_mismatch` is usable for Restore only when repair is explicitly reported safe and deterministic.

The validation report contains a binding over:

```text
conversation_id
source entrypoint path + SHA-256
current path + SHA-256
index path + SHA-256
continuation_revision
```

Continuation-derived extraction MUST reject a stale binding.

---

## 8. Extractor API

Python API:

```python
extract_context(package, **selectors) -> dict
```

CLI selectors:

```text
--current
--index-catalog
--all-messages
--tail
--range START:END
--message SEQ
--segment SEG-ID
--key-refs SEG-ID
--around SEQ
--neighbors N
--attachment ATTACHMENT-ID
```

`--tail`, `--segment`, and `--key-refs` require a matched validation report.

Raw selectors do not require validated continuation.

The Extractor emits an Extraction Bundle plus a compact JSON Receipt. The Receipt MUST always state:

```text
semantic_read_performed: false
```

Delivery proof and semantic acquisition are different facts.

### Message delivery invariants

- selected messages are deduplicated;
- output follows Canonical Conversation order;
- no body preview/truncation mode exists in v1;
- a missing source body produces a descriptor with `available=false` rather than silently removing the message;
- large bodies may be externalized into exact UTF-8-preserving transport parts;
- transport chunking does not alter message identity or semantic Segment boundaries.

### Index Catalog

The catalog includes every persisted Segment's compact navigation fields but not full Key Refs by default.

`complete_for_persisted_segments=true` requires catalog Segment count to equal persisted Segment count.

### Attachments

Requested attachment bytes are materialized exactly and never executed or automatically unpacked.

---

## 9. Proof-layer separation

The implementation MUST preserve four different proofs:

```text
Inspector
-> source exists

Validator
-> continuation still binds safely to source

Extractor
-> selected complete material was delivered

Acquisition Trace
-> model actually semantically processed delivered material
```

A successful script call never proves model semantic traversal.

---

## 10. Multi-package rule

Each public script processes exactly one Context Package per invocation.

Cross-package ordering, deduplication, branch handling, and Working Context reconciliation remain the Skill Reader's responsibility.
