# UX quick review — import creation acknowledgement

## Scope and evidence

Scoped review of one existing web-app recovery message, 2026-10-24. Audience:
mixed users importing private conversation files; data integrity and avoiding
duplicate work matter more than cosmetic polish. Evidence is source code and
isolated synthetic API fault injection, not a mounted browser or user study.
No accessibility conformance, viewport or production usability claim is made.

Seen:
- `apps/web/features/import/import-workspace-copy.ts:46-47,133-134,168-184`:
  Chinese/English code-specific errors and formatter precedence.
- `apps/web/features/import/import-panel.tsx:197-209,418`: creation success and
  error rendering; the existing `role="alert"` is preserved.
- `apps/api/app/api/routes/adaptive_imports.py:126-173`: commit attempt and
  response preparation share error handlers.
- `apps/api/tests/test_import_analysis_queue.py`: post-commit refresh/response
  failures leave an owned queued job that can be reopened and processed.

Not seen: mounted dialog, physical device, assistive technology, production
content, actual duplicate-upload frequency. Those are not inferred as observed.

## What matters

The current error says analysis was not saved and recommends choosing files
again. The server can already have committed that analysis before the response
fails. The generic mutation fallback correctly acknowledges uncertainty, but
the two known error codes take precedence over it. Re-uploading at that point
can duplicate work; the exact frequency is unknown. A local wording correction
can name the existing read-only recovery surface without changing the workflow.

## Finding

| ID | Kind | Dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| COPY-128 | Defect | Error recovery; content | High | Observed (code + synthetic API outcomes); rendered presentation unverified | S |

**Evidence.** `SESSION_PERSISTENCE_FAILED` reads “这次导入分析未能保存。请重新检查并选择文件后再试。”
Its English translation says “This import analysis could not be saved. Review
and choose the files again before retrying.” `SESSION_ANALYSIS_FAILED` similarly
recommends choosing files again. These mappings precede the existing uncertain
mutation fallback. API persistence/analysis error messages also imply failure,
even when an attempted COMMIT may have succeeded.

**Consequence.** A user following the recovery advice can upload another copy
while the first analysis is already queued. The UI has not established that no
task exists, so it must not communicate that as fact.

**Recommendation.** Keep both codes and the existing alert. Replace their
localized advice with:

- Chinese: “导入分析的提交结果尚未确认。请先在任务中心核对是否已有本批分析，再决定是否重新上传。”
- English: “Import analysis submission is not confirmed. Check Tasks for this
  batch before uploading it again.”

After a server-side commit attempt, use equally uncertain API message text.
Before that attempt, definite staging failures may retain their existing
message. This scoped change does not automatically retry, create another job,
discard selected files, or add a new workflow/state.

## Priority and what stays

1. Implement COPY-128, linked to optimization candidate #128.
2. Verify both code-string and structured-API errors in both locales, alongside
   existing permission, validation and read-failure behavior.
3. Verify the actual post-commit API failures no longer assert that nothing was saved.

Keep the generic unknown-write wording, specific validation diagnostics,
Task Center re-entry, file retention and ownership checks. No layout, theme,
navigation, offline package or database change is justified by this finding.

## Open questions

Does the existing Tasks label make the interrupted batch easy to identify when
many imports are queued? A mounted recovery pass can answer that; this review
does not claim it is broken or redesign it.
