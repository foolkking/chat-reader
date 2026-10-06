# UX audit — Context export reliability (2026-10-06)

## Scope and evidence

Quick review of the existing Web flow Export → For AI / Prepare maintenance →
Context download, at source 25c7f6a (documentation head 6183f41). Audience is mixed:
users expect a portable, accurate conversation file without inspecting ZIP internals.
Evidence so far is source code and previous CI delivery coverage, not a new rendered
or production corruption test. This is one stage of the broader product audit; it
is not a complete audit of all pages, offline export, accessibility or external Skills.
No semantic Current/Index validation or extra adoption step is proposed.

## Summary and prioritized findings

The Context entry points correctly use a normal background job and one downloadable
file. Existing source-revision, supplementary-dependency and saved-file-generation
checks reject several concurrent changes. These checks do not validate copied
attachment bytes or own filesystem cleanup through transaction failure. The user can
therefore be offered a package that looks successful but disagrees with its manifest,
or a failed export can retain unnecessary files. Runtime reproduction is next; source
observations below do not claim measured frequency or a rendered defect.

| ID | Kind / dimension | Severity / confidence | Evidence | User consequence | Recommendation / effort |
|---|---|---|---|---|---|
| ERR-01 | Defect; output integrity and trust | High; Observed (code), runtime outcome Inferred | `apps/api/app/services/exporting/context_package.py:201` only checks size; `:402` writes asset files without hashing the copied stream; manifest uses DB SHA | A same-size damaged file can be delivered as apparently complete, then rejected by a reader or external Skill | Hash bounded copied bytes against stored size/SHA before publication; retain explicit missing-file behavior. M |
| ERR-02 | Defect; recovery and storage | High; Observed (code), runtime outcome Inferred | `context_package.py:390` begins the ZIP try/finally that only removes JSONL; temporary ZIP cleanup is in a later try block | An interrupted export can leave a large orphan even though the user has no usable result | Enclose all staging work in one cleanup boundary, preserve original failure. M |
| ERR-03 | Defect; transaction consistency | High; Observed (code), runtime outcome Inferred | `context_package.py:421` publishes before DB flush and lacks `track_archive_object`; worker commits later in `background_jobs.py:1274` | Failed persistence can retain an undiscoverable final package, consuming space after retries | Use existing transaction-owned artifact cleanup and verify flush/commit/close failures. M |
| PERF-01 | Risk; bounded work and feedback | High; Observed (code), resource exhaustion Inferred | `context_package.py:65` materializes all messages; `:124` accumulates all records; no bundle/CanJSON budget checks | A very large export can monopolize the single worker or exhaust memory/disk before a useful failure | Add existing size/count budgets and bounded serialization/copy checkpoints; measure before making performance claims. M/L |

## What works and stays

Keep the three supplied Skill ZIPs and personal choices. Saved Current/Index remain
user-managed members without semantic validation. Preserve Raw-only, partial-scope
exclusion, the original fingerprint/manifest representation, missing-attachment
metadata, the normal task/lifetime workflow and Chinese/English recovery states.
The established paper/graphite/sea-green UI requires no visual redesign for these
backend defects. Direct Markdown/CanJSON bundles already have stronger safeguards
and supply implementation patterns; their prior acceptance is not evidence that the
separate Context builder has them.

## Next evidence

Run small isolated synthetic reproductions for same-size corruption, write failure,
rollback after publication, and asset/account state changes during packaging. Use
actual published ZIPs and filesystem state, not string-only assertions. Production
volumes, credentials and user content are outside the reproduction. Record outcomes
before implementation and add focused regression tests. Browser error presentation
and true PostgreSQL concurrency remain separate required gates.

## Runtime reproduction (before implementation)

`ux-audit-context-export-2026-10-06-evidence/probe.py` executed the actual released
Context builder from CI image 25c7f6a with synthetic SQLite-in-memory rows and a
64 MiB tmpfs, in a networkless read-only disposable container limited to 0.5 CPU /
512 MiB. No production volume, environment or credentials were mounted. No image
was built. The container was removed after execution; only aggregate JSON evidence
was retained in `baseline.json` beside the probe.

ERR-01/02/03 are now **Observed (executed synthetic runtime)**: the generated ZIP
reported complete while its actual object checksum mismatched; interrupted copying
left one staging file; after rollback there were zero artifact rows but the final
file still existed. This establishes correctness failures, not real-world frequency.

**ERR-04 — High, defect, Observed (executed synthetic runtime), M:** revoking an
asset or disabling the source account in the actual packaging callback still allowed
publication. `context_package.py:414` rechecks revision/dependencies/generation but
not current source ownership/account availability or copied asset status. Recheck
these before publishing; do not use a read snapshot as continuing authorization.
The synthetic callback is not proof of PostgreSQL concurrency behavior; add actual
PostgreSQL transactions to regression coverage. PERF-01 remains code-observed and
needs bounded-read/resource-limit tests, not a claim of measured exhaustion.
