# Imported HTML attachment cards: merge failure — 2026-11-25

## Observed production failure (read-only)

Production was `v0.1.7` / `6da435a70f0485a116c84525da899bfd8f234434`,
schema `20261123_0064`. Two requests on November 25 at approximately
18:30 and 18:32 Asia/Shanghai failed in about 1.3 seconds at 10%,
before copying messages: two source conversations, 376 active messages.
Neither receipt published a target. No active queued/background task remained;
the running worker reported `OOMKilled=false`. These observations do not prove
that this host never has memory pressure.

A separate process used PostgreSQL **READ ONLY** transactions with 6-second
statement and 250-ms lock bounds. It called the existing source validation,
not the merge handler. All 376 current versions existed. Of 289 attachment
occurrences, four on the same paragraph failed the block-reference comparison.
All four attachments were active and available, imported through
`adaptive_zip`. The paragraph stored four lines of HTML cards in `data.text`,
with two `href` and two `src` bindings and no `sanitized_html` projection.
The HTML attribute reader recognized all four; the Markdown-only reader
recognized none.

**Cause:** import already supports real HTML resource attributes, but merge's
typed Markdown/text projection omitted these attributes. Its mandatory graph
check therefore rejected valid input. Removing the check, deleting occurrence
rows or changing the user's text would conceal the defect, not fix it.

No source text, filenames, conversation/message/attachment IDs, credentials or
production source files were copied into this record. No production task was
retried during diagnosis. One initial shell probe had a trailing heredoc marker
error after its read-only transaction had rolled back; corrected probes
confirmed the same static failure. This was not an application exception.

## Candidate repair and boundaries

- Interpret real HTML `href/src/poster` attributes as source-coordinate resource
  bindings alongside the existing Markdown parser.
- Remap the destination, canonical projections and content hashes during copying;
  retain code examples, escaped tags, comments and other literal content.
- On the user's subsequent explicit request, ordinary reference defects are
  recoverable **during conversation merge only**. Reuse the import contract's
  unavailable attachment representation; do not change the import pipeline.
- Build a separate attachment map for every source conversation. Missing,
  deleted or out-of-scope identities become new target-owned `missing` records,
  with no asset, download URL or copied foreign metadata. An attachment owned
  by another selected source must not be borrowed to repair this source.
- Repair an occurrence's block only when one actual block proves the location;
  otherwise retain its declaration with no location. Fill absent associations
  from real canonical bindings, without replacing the original text.
- Keep target ownership and graph validation, immutable source rows, atomic
  commit/cancellation and receipt idempotency. Access-denied source
  conversations, storage/database failures and unprovable canonical structure
  are not converted into successful partial merges.
- Use the same combined reference reader for subsequent source editing,
  conversation splitting and adjacent-message merging, so a successful first
  merge is not followed by silently lost occurrence links.
- No schema change or production data repair is needed for this defect.
  The other pending extension features still require migration 0065.

### Result and recovery contract

The committed task and merge lineage event contain a bounded
`attachment_recovery` summary: `missing_attachments`, `repaired_occurrences`,
`unlocated_occurrences`. Counts include copied historical versions where
applicable; missing attachments count distinct target records, not repeated
URLs. No private text, file names or identifiers are added to diagnostics.

The task remains committed because the new conversation is fully published.
The Web task result distinguishes an ordinary success, a repaired association,
and “merged, attachments need review”; the last two categories do not offer a
retry that would create another merge. The existing open-result action remains.
Results survive refresh/re-entry; absent summary fields retain old-client
behavior. Original conversations are unchanged and available for comparison.

The old tests named `test_merge_fails_closed_for_broken_source_attachment_graph`
and `test_merge_worker_rolls_back_target_when_source_occurrence_is_missing`
retain their CI identities. Their assertions are deliberately updated for this
user-approved product change: the strict source audit still detects every
problem, but merge must create a valid target or missing placeholder and leave
the source untouched. Separate fault injection still requires full rollback,
and source editing/splitting still reject unauthorized attachment identities.
No skip, timeout, quality threshold or historical image-repair whitelist changes.

## Reproducible verification

All inputs below are synthetic, including API logs and downloaded fixture files.
The new `tests/test_merge_html_attachment_api.py` creates a real Markdown ZIP
with two file cards and two images, uses the actual import/merge worker, checks
downloaded bytes, canonical graphs, original-row preservation and idempotent
receipts in both legacy-v1 and bounded-v2 import modes.

Before the repair:

- Eight positive cases failed (merge, split, adjacent merge and source edit),
  while six deliberately corrupted graphs remained rejected.
- Six separate source-edit controls showed that HTML resource identities bypassed
  the Markdown-only occurrence validation. This does **not** establish that the
  protected attachment download endpoint disclosed another user's bytes.

An intermediate candidate passed all 22 API controls, including original-receipt
retry and foreign/missing/malformed identity rejection. Independent review then
identified entity-encoded destinations and literal/invalid-HTML edge cases;
these were repaired with source-coordinate parsing. An additional cross-paragraph
test exposed a literal/live duplicate being rewritten in both stored blocks;
the final parser retains whole-source context and only accepts an unambiguous
projection. Its dedicated suite has 83 cases; the 28 real-API cases subsequently
passed in both import modes, including all six original literal regressions.

The first integrated recovery run passed 122 API/parser/history cases in
98.85 seconds. Final local evidence is in [verification.json](verification.json):

- Related import/edit/split/reference regressions: **378 passed** in 880.93s.
  Independent review subsequently found an unavailable-but-`unresolved`
  attachment missing from the result count; the counter was corrected without
  granting access, and the exact affected suites rerun: **162 passed** in 331.05s.
- Real PostgreSQL + FastAPI + fresh execution children: **50 checks passed**,
  including 376 messages/289 attachments, downloaded bytes, historical graph,
  source preservation, recovery, foreign scopes, rollback and receipt replay.
  The final exact source hashes are recorded in
  [postgres-worker-final.json](postgres-worker-final.json).
- The unresolved-file case has separate [red](unresolved-asset-red.json) and
  [green](unresolved-asset-green.json) PostgreSQL evidence: download remains
  denied; the task now truthfully counts the unavailable attachment.
- Actual mounted Edge task UI: **176 scenarios across 16 layouts**,
  320/375px, Chinese/English, light/dark, compact/center. No retry on committed
  merges, correct counts and result link, keyboard focus and no horizontal
  overflow. Synthetic receipts, not production or mobile hardware.
- Web lint/typecheck pass; CI source controls **33 Python + 124 Node + 88
  Playwright source cases** pass. API collection is **7,418**, with only the
  original three allowed skips. This change adds 151 cases and a required
  mounted browser gate; original CI thresholds remain.

The two fixture setup/name mistakes, the early deferred-analysis/denial-code
harness mistakes, and one local psycopg cold-import failure are retained rather
than hidden. All final applicable cases were rerun; details and evidence paths
are recorded in the verification manifest.

The previous candidate `64577eafaf06ae51b03c5c1b2f9c3175991467c7` passed
full CI `45595805439`, attempt 1, all 19 jobs. Extension
`e18bb4cae7674af66a08fd3be50c113475f34e5a` passed `45595745763`, attempt 1.
Both were checked after a measured 1500.010-second command wait.
**Those runs do not certify this later merge repair.**

Current checkpoint: local repair/review complete, awaiting the exact new full
CI. No new release, deployment or production retry is certified here.
