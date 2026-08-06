# 2026-08-06 Implementation Results

## Status Vocabulary

- `PASS`: executed and passed in the stated environment.
- `PARTIAL_PASS`: the executed subset passed, but a related scenario remains unverified.
- `NOT_PRODUCTION_VERIFIED`: implemented or locally verified, but not verified on King in this release.
- `NOT_IMPLEMENTED`: intentionally outside the completed baseline.
- `FAILED`: executed and failed; the exact failing path is not approved for reuse.
- `BLOCKED`: cannot proceed without an external dependency or decision.

## Local Verification

| Area | Status | Evidence |
| --- | --- | --- |
| Web lint | PASS | `corepack pnpm run lint`; zero warnings |
| Web typecheck | PASS | `corepack pnpm run typecheck` |
| Web production build | PASS | Next.js build; 9 application routes |
| API suite | PASS | 203 passed, 1 fixture-gated skip in the default command; the real attachment fixture module was rerun with `CHAT_READER_E2E_FIXTURE_DIR` and passed 9/9 |
| Alembic | PASS | single head `20260805_0020` |
| PWA baseline | PARTIAL_PASS | 8 passed; 19 online/fixture scenarios conditionally skipped by the default command |
| Attachment/SVG/Share Playwright | PASS | real Bundle fixture: SVG is an `IMG` in Reader and the body-level dialog; focus, scroll lock, Share access and revoke behavior passed |
| Attachment upload Playwright | PASS | 4/4: file selection, exact-position drop, clipboard paste, fenced-code choice, independent drafts, message save, Reader rendering and preserve-as-unplaced close behavior |
| Long Reader Playwright | PASS | 4/4 target mounting, TOC, layout-anchor and annotation restoration scenarios passed |
| Attachment export options | PASS | streaming and background ZIP tests cover description, annotations, notebook and source refs |
| Message version rendering | PASS | API regression proves selecting a version returns its persisted render blocks immediately |

## Real Fixture Baseline

The fixture is read through `CHAT_READER_E2E_FIXTURE_DIR` and packed only in a temporary test directory. Tests do not modify the source fixture or persist its conversation body.

| Metric | Verified |
| --- | ---: |
| Conversations / messages | 1 / 8 |
| Attachment records | 20 |
| Resolved / missing | 19 / 1 |
| Physical objects | 18 |
| Occurrences | 21 |
| Unplaced attachments | 1 |
| Resolved scan state | 19 `scanner_disabled` |

The AI context package contains 18 content-addressed objects and reports partial asset completeness. The portable Markdown ZIP contains 19 business attachment paths, rewrites links to relative paths, and contains no `cr-asset://` URI.

## King Production Acceptance

| Area | Status | Evidence |
| --- | --- | --- |
| Incremental deployment | PASS | GitHub Actions run `31064129902` built the Linux images for commit `fba64b6`; King pulled the same commit, verified the artifact checksum, loaded the images, ran migration, and recreated API/worker/Web without an on-host build |
| Migration and capabilities | PASS | production head `20260805_0020`; scanner disabled, unscanned allowed, basic preview enabled, complex preview disabled |
| Attachment Bundle import | PASS | checksum-scoped fixture imported once; expected 1/8/20/19/1/18/21/1 statistics verified |
| Reader attachment rendering | PASS | Chrome observed 20 attachment blocks, 3 inline images in the loaded view and 6 inline text previews after hydration |
| Full-page attachment preview | PASS | Chrome verified the dialog is a direct `body` child, equals the viewport, locks body scrolling and displays the original image endpoint |
| SVG attachment preview | PASS | Production Chrome verified inline SVG uses one `IMG`; the body-level dialog content also uses one `IMG`, with no inline SVG/script/object/embed/iframe; focus trap, Esc, backdrop close, scroll restoration and trigger focus restoration passed |
| Export secondary options | PASS | Chrome exposed description/annotations/notebook/source-ref controls; generated manifest recorded `true/true/false/true` for the selected options |
| Failed task dismissal | PASS | two stale failed cards were closed; reload kept them hidden in the same browser profile |
| CanJSON/Markdown packages | PASS | context and portable Markdown ZIP counts, hashes, relative links and completeness were inspected on King |
| Structured sidebar DnD | PASS | dedicated synthetic conversation moved into a project and back to unclassified; reload preserved placement |
| Share attachment scope | PASS | user-confirmed production E2E: allowed image/text/media preview and download worked; out-of-scope ID access was rejected; revocation invalidated attachment access |
| Ordinary attachment upload from API | PASS | production upload session/finalization created a `scanner_disabled` conversation attachment |
| Ordinary attachment upload through Chrome | PASS | user-confirmed production E2E: file selection -> upload session -> conversation attachment -> message version/Reader -> refresh -> download/export |
| Message version immediate attachment rendering in Chrome | NOT_PRODUCTION_VERIFIED | deployed and API-covered; hidden hover-only version control could not be activated reliably through the browser bridge |
| System `.cr v4` export | PASS | production archive generated and contents inspected; no secret/config/cache paths present |
| System `.cr v4` restore | PASS | user-confirmed empty-instance production-equivalent restore: projects, conversations, versions, attachments/objects, annotations, notebook, source refs, placement/order, hashes, derived rebuild and Reader opening passed |
| Acceptance data cleanup | PASS | fixture and synthetic conversations hard-deleted; synthetic project archived because the product has no project-delete endpoint |
| GitHub/server synchronization | PASS | Application source and deployed image source resolve to `fba64b6c5d304805979c44d07d974606f49e007e`; a docs-only follow-up records final evidence, and the pre-sync server worktree remains recoverable in `stash@{0}` |

## Production Incident

| Event | Status | Result |
| --- | --- | --- |
| Build Web image on the 2 GiB King host | FAILED | Even with the 418 MiB worker stopped, `next build` caused the kernel to kill the PostgreSQL checkpointer |
| PostgreSQL recovery | PASS | Container stayed running, WAL recovery completed, health returned, and a post-recovery custom dump passed `pg_restore -l` |
| Future deployment method | REQUIRED | Build Linux images in CI/an independent host and deliver through a registry or `docker save/load`; do not compile Web on King |

## Scanner and Content Policy

- The current deployment actively disables attachment malware scanning and content security review.
- Attachments remain usable in the explicit `scanner_disabled`/`unscanned` state; the Chinese UI displays “未扫描”, never clean/safe or “已通过扫描”.
- This is an accepted policy for the current single-user deployment and does not mean that any file passed a security check.
- Object status, byte size, SHA-256, storage-key confinement and authenticated content routes remain enforced.

## Deliberate Limits

| Capability | Status | Fallback |
| --- | --- | --- |
| Office conversion/inline preview | NOT_IMPLEMENTED | Authenticated download |
| OCR | NOT_IMPLEMENTED | Original file download |
| CAD preview | NOT_IMPLEMENTED | Original file download |
| Complex archive browsing/conversion | NOT_IMPLEMENTED | Authenticated download |
| Local ClamAV on the 2 GiB King host | NOT_IMPLEMENTED | `DisabledScanner`; optional remote scanner later |
| Full online Playwright matrix in default PWA command | PARTIAL_PASS | Conditional tests require running API and explicit fixture flags |
