# System noise publication recovery — 2026-10-07

## Scope and evidence

Batch 22 of the ongoing local UX work. This scoped audit follows the import and
global noise review path into the system rules used by both. Previous completed
review/selection/personal-rule changes remain intact. No commit, CI, deployment,
production data access or local image build. Temporary runtime files belong to
`C:\Users\86182\Desktop\wkkk\chat-reader-rule-publication-20261007`.

Initial evidence is source inspection of `admin-noise-rule-settings.tsx`,
`admin_noise_rules.py`, `cleanup_rule_access.py`, the administration client and
existing publication/scan integration tests. Runtime reproduction and final
evidence are recorded below as they are obtained; source observations do not
claim measured appearance or real-user research.

## Findings and ordered work

| ID | Dimension / severity / confidence | Evidence and user consequence | Recommendation / effort |
| --- | --- | --- | --- |
| PUB-01 | Feedback, recovery / High / Observed (code) | PublicationRow awaits three list invalidations before clearing the saving state. A saved publication can still appear pending while unrelated reads stall. | Acknowledge the committed state first; refresh separately. M |
| PUB-02 | Error recovery / High / Observed (code); failure experience unmeasured | Failed writes expose an error then permit another write; no read-only result check. A lost response can encourage a second publication or withdrawal. | Bound requests; keep the intended values and check current state before retry. M |
| PUB-03 | Error prevention / High / Observed (code); concurrency to reproduce | Publication and withdrawal lock the rule but do not compare the administrator's base. An old window can overwrite or withdraw a newer version. | Optional publication token checked after a fresh canonical lock; new Web always supplies it, explicit comparison before rebasing. M |
| PUB-04 | State coverage / Medium / Observed (code) | Reopened history can remain cached; radios stay active after failed reads. | Refresh on reopen, retain readable history but disable stale choices. S |
| PUB-05 | Content / Medium / Observed (code); rendering unmeasured | The match preview exposes EXACT / WHOLE_LINE and role enums. | Reuse localized personal-rule vocabulary; preserve exact matched text. S |

Quick wins are PUB-01 and PUB-04/05. PUB-02/03 require actual API and PostgreSQL
proof, because interface-only guards cannot protect concurrent writes.

## Interface decision

Follow `.interface-design/system.md`: a quiet rule ledger, not another wizard.
The administrator must understand the actual public revision and deliberately
choose a change. The domain is raw evidence, literal matching, immutable versions,
personal grants and explicit publication. Paper/surface, graphite text, muted ink,
sea-green actions, amber review and restrained danger use existing tokens.
Preserve the app font, 4px spacing grid, subtle border/surface depth and 44px
actions. Recovery appears beside the affected row; server/current and intended
name/version compare side by side even on narrow screens. No permanent explanatory
cards, duplicate rule copies or automatic retry. Existing confirmations and
personal grants are retained.

## Working behavior left unchanged

Publication remains Root-only and selects an immutable validated version.
Personal enablement, revisions acquired by earlier use, admitted scans and source
text are not changed by publishing or withdrawal. Both import and global scans
still default to KEEP and require explicit review to remove text.

## Verification record

Baseline: both stale-publication API cases failed as expected (publish returned
200 and withdrawal 204 instead of 409), and both held-refresh browser cases failed
after the real database had already changed. Two synthetic baseline screenshots
show stale publication labels and continued Saving. These upgrade PUB-01/03 to
Observed (API/browser reproduction). The baseline runner also printed its
maximum-failure stop and a generic run-level error with no further detail; this
is preserved, not counted as an additional proven product defect.

Implementation adds an optional publication base, refreshed PostgreSQL row locking,
read-only current-state endpoint, atomic response/audit state, bounded client
requests, retained draft comparison and readable matching scope. Legacy callers
may omit the base; legacy DELETE retains 204, new Web requests a state response.
There is no schema migration. The row editor is extracted into
`admin-noise-publication-row.tsx`; the settings shell retains pagination/dirty
dismissal and disables actions when its last read failed.

First full API attempt: 12 passed / 15 failed. Thirteen failures were anonymous
fixtures run with AUTH_ENABLED=true; two expected raised exceptions from audit
failure, but this fixture correctly returns HTTP 500. Correcting only the auth
environment produced 25 passed / 2 failed. Correcting the test expectation and
asserting persisted rollback produced **27 passed / 0 skipped**. The injected
audit failures remain intentional 500 cases. Real PostgreSQL tests produced
**7 passed / 0 skipped**, including three competing publication pairs with
preloaded ORM state, grants/deletion/migration and personal-edit regression.

The first final browser gate produced **35 passed / 0 skipped**: 18 recovery
cases, six publish/use/withdraw/relearn cycles and 11 import/global navigation
cases. Real API/worker/storage effects are asserted; network holds/lost responses
are deliberately injected. Three widths, Chinese/light and English/dark, keyboard
rebase/discard, 20-second timeout and failed read recovery are covered.

Visual review covered 60 images in six contact sheets (2 before, 58 after), with
key views inspected at full size. It found a further stale-history inconsistency:
state comparison could show public v2 while expanded history still listed only
v1. State checks and successful writes now invalidate that rule's history too;
the six conflict cases assert the new matcher is actually visible. A final
publication-specific rerun follows this change and is recorded below.

That first 24-case rerun had 16 passes, three status-locator failures and five
unrun cases: tests selected both the new history-loading status and the already
confirmed success status. Locators now target the actual acknowledgement rather
than assuming one status element per row. No product behavior was reverted.
The corrected final publication gate passed **24 / 24, zero skips**. Together
with the preceding unchanged navigation cases, **35 distinct browser cases** have
passing evidence; 35 + 24 is not a count of independent cases. The final 38 images
were reviewed in four more contact sheets and three full-size key views. This
makes 98 retained/reviewed images across before/after/final.

Final lint, nonincremental TypeScript, ordinary Web build, diff whitespace and
Alembic heads pass; the head remains `20261006_0048`. No new full API/PWA gate is
claimed. Test services on 65438/8008/8328 and the Playwright Web server on 3107
are stopped. All changes, including the earlier 21 batches, remain uncommitted;
HEAD stays `975c1ee`, nothing is staged, and production has not changed.

Preparation notes: one Windows wildcard-path `rg` and one nonexistent test-path
lookup were corrected using actual filenames. An attempted combined delete/add
patch of the same path was rejected before changing files; row extraction used
an additive component and a scoped edit instead. A transient low C-drive reading
recovered before tests; no disk cleanup or alternate temp location was used.

No overall UX score, new full API/PWA/Share/Offline/Reader-suite pass, external
Skill execution or production validation is inferred. Source/canonical behavior
was exercised through real cleanup/scan tests, not a full-site regression. Other
administrator settings and production are outside this batch. Broader unresolved
issues are not declared complete by this bounded audit.
