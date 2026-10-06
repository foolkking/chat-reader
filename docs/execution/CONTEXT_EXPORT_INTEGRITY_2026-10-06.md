# Context export integrity and bounded processing — 2026-10-06

## Scope and baseline

Production source remains `25c7f6a`, accepted under CI `37453812341`. That release
must not be redeployed as if it covered these changes. The broad optimization goal
remains active. This stage follows the [scoped audit](ux-audit-context-export-2026-10-06.md)
and its synthetic pre-fix runtime reproduction; it is not a completed whole-site audit.

Reproduced outcomes: same-size corrupt attachment published with complete status;
interrupted copying left a staging ZIP; rollback left a published file with no DB
artifact; account/asset revocation during packaging still published a result.

## Changes

- Hash the actual bounded attachment stream against stored SHA/size; preserve
  missing-object partial Raw output and metadata-only exports.
- Own staging files from allocation through cleanup; track unique final paths with
  the existing transaction cleanup service, retaining normal download filenames.
- Stream JSONL immediately and query message bodies/references in batches of 100;
  use SQL subqueries instead of a giant ID parameter list. Stream attachment metadata,
  historical annotation anchors and annotations. Keep bounded message identity and
  exported-object metadata, and subject individual records to existing line limits.
- Count only the selected reading range against the message budget, preserving
  original sequence numbers. Enforce existing compressed/expanded/entry/object limits.
- Permanent builds read one PostgreSQL snapshot, then recheck live source/account,
  asset availability and source/dependency/file generation before and after publication
  I/O. Final shared locks follow owner → conversation → ordered objects. Read-only
  temporary exports take no row locks.
- Localize actionable Context failures in Export and Tasks. Extend the actual browser
  corrupt-object → repair → download/checksum matrix to Context at 375/768/1440px.

No schema, package version, Share authorization, Skill Bundle, Current/Index validation,
candidate or adoption change. No model execution, local/server image build or local
cleanup. Off-site/scheduled backups remain excluded; any eventual production release
retains the latest two verified backups and preserves data/configuration/PostgreSQL.

## Verification checkpoint

- Original 23 integrity cases passed again after streaming changes, using the existing
  CI-produced API image with working-tree overlays in a networkless, read-only,
  disposable container. Real SQLite foreign keys, worker, files and ZIPs were used.
- Local nonincremental TypeScript passed. No local runtime/browser test is claimed:
  C-drive temporary capacity is exhausted and no new E-drive exception was assumed.
- Added selected-range, 602-message streaming/cancellation and PostgreSQL two-session
  races at serialization and after physical publication.
- One auxiliary invocation named a nonexistent test file and ran zero tests; it is
  not counted as passed. The corrected actual suite names are used for the follow-up.
- Full API/Context/external Bundle/browser/PWA/PG/migration gates and exact-source CI
  remain pending. Deployment and production acceptance have not occurred for this stage.

Focused final results: **26 integrity/streaming cases passed** (21.21s), including
actual 602-message bodies, a serialized prefix already on disk while processing,
bounded retained ORM bodies, cancellation with no output, and selected-range original
sequence preservation. **20 Context export/return compatibility cases passed** (25.14s).
Outputs are retained in the audit evidence directory. Changed-file ESLint and Python
AST checks also passed. These are separate suites; no PostgreSQL/browser result is
claimed from the isolated SQLite runs.

The first expanded compatibility run failed because the historical import fixture
assigned a legacy administrator UUID without creating its account. Its fixture now
seeds the real administrator shape from migration 0030; production account checks
remain strict. An interrupted combined run produced no complete summary and is not
counted. Clean split reruns produced the final counts above. Only synthetic data and
the existing CI image were used, with networkless read-only disposable containers,
0.5 CPU / 512 MiB and bounded tmpfs; no host data/configuration was mounted.

Evidence stays synthetic. Existing `apps/web/tsconfig.tsbuildinfo` remains unstaged;
old untracked auth-test directories are neither inspected nor cleaned.

## First full CI and follow-up

Source `d89c3d7ee67b5476ee28ff7124e1350e7fdce360` was pushed and CI
[37468343599](https://github.com/foolkking/chat-reader/actions/runs/37468343599)
ran against that exact source. API finished **1041 passed / 1 failed / 3 skipped**.
All **13 real PostgreSQL Context publication cases** and **26 integrity/streaming
cases** passed. The failure was an archive test inserting the legacy administrator
that its shared import fixture now already creates. The test now updates that
fixture account's synthetic email instead of inserting a duplicate; archive restore
assertions and production authorization are unchanged. Redacted summary is retained
as `first-ci-api.json`. Failed-source images must not be deployed.

Follow-up code also maps the reused ZIP writer's progress onto Context's 55–95%
packaging phase, preventing a visible reset to 10%; the real export test asserts
monotonic phase percentages. Task labels distinguish exporting attachments from
building an offline copy. The 26-case suite passed again (21.79s). Fresh exact-source
CI is required for this follow-up, including the archive fixture correction.
The corrected actual archive round trip passed in isolation (1 case, 8.40s);
follow-up nonincremental TypeScript and changed-file ESLint passed too.

Follow-up source: **b45f04939a728c86bbff769c36ea7574d6a1856d**; exact-source
[CI 37470769275](https://github.com/foolkking/chat-reader/actions/runs/37470769275).
Its API gate passed **1042 cases / 3 skipped**, including all 13 PostgreSQL Context
cases; runtime/Bundle 64 and cleanup 53 also passed. Migration remains **0048
head/current**. Final browser/image gates and production deployment are pending.

First-source Web and settings gates subsequently passed: settings **176** plus
**1** fresh PostgreSQL restore; Context **35**, auth **18**, offline negatives **17**,
baseline PWA **135 / 324 gated skips**. The three new Context corruption/recovery
browser widths passed with actual ZIP hashes. These intermediate results do not
replace final-source CI. See `first-ci-browser.json` and `final-ci-api.json`.

Release helpers are prepared in memory only, rebound to b45f049 and the currently
live 25c7f6a image IDs. All 16 helpers passed syntax checks, including host Python
3.6 compatibility where required. Preparation does not execute deployment. Final
acceptance will add real Context to the existing attachment ZIP smoke, compare
private Continuation table fingerprints, and wait for API/Web health before smoke.
Production backups, image tags, containers and configuration have not changed at
this checkpoint. Old 25c7f6a's completed deployment must not be replayed.

## Final CI acceptance

CI **37470769275** completed all five gates successfully for **b45f049**. API:
**1042 passed / 3 skipped**; settings: **176 passed**, plus **1** fresh PostgreSQL
restore; Context **35**, authentication **18**, offline negatives **17**, baseline
PWA **135 / 324 gated skips**. Suites overlap; gated skips are not passes. Runtime/
Bundle **64**, cleanup **53**, lint/typecheck/build and migration validation passed.

All three Context error → repaired retry → actual downloaded-object checksum cases
passed at 375/768/1440px. Six synthetic failure/download screenshots from original
settings artifact **11418406238** were inspected under the evidence `final/` folder:
the main regenerate/download control remains usable, error/recovery text wraps, and
desktop/tablet controls fit. Mobile uses the existing scrollable lower sheet, with
secondary delivery information below its initial fold. This scoped evidence does
not claim an interactive production browser audit or complete site-wide UX closure.

Production release preparation now starts from those exact-source CI artifacts.
Deployment, actual ZIP acceptance, backup retention and image cleanup outcomes must
be recorded separately below after they execute.

## Production release and cleanup — complete

Original artifact **11419041245**, producer attempt **1**, delivered a
**193,636,974-byte** archive, SHA-256
`d7bd98cf444e4f7aa49a125ca80a9b278ed03a5e51480fb1d667312de0497b76`.
All 50 archive blobs/configs, image identities and 17 exact-source support files
were independently verified; the server transfer digest matched. Helpers were
rebound to the actual live 25c7f6a baseline and b45f049 target. No local or server
image build occurred.

| Runtime | Verified image |
|---|---|
| API / worker / migrate | `sha256:c13e9171ba1c40e838d59ecedf5adddbda88cce13fad5ad8761f23c9f6d6889a` |
| Web | `sha256:886cd8e97cb41bacffc2d6b056e120c97000d44749dceb7506a597f9a113f216` |

Space preflight passed. While API/worker writes were stopped, five-component backup
**chat-reader-20261006T141424Z** was created and verified. PostgreSQL was not replaced
or restarted. Migration remained **0048 head/current** and administrator deployment
configuration was unchanged. Only API/worker/Web were recreated with prebuilt images.

Production acceptance checked login, 14 settings/read-only endpoints, guidance,
three exact default Skill ZIPs, unauthorized private upload/download rejection,
four direct export formats, batch ordering/idempotency, and three attachment/Context
formats. **148 actual object checksum checks**, manifest/task counts, source identity,
Range/ZIP downloads, physical close reclamation and regeneration idempotency passed.
All 73 historical exports remained physically reclaimed. No real bodies or user
files were copied into evidence.

Canonical counts, personal Skill state, **301 stored attachment hashes**, protected
import/offline fingerprints and private Context tables were unchanged before/after
migration and acceptance. The production Context tables were empty, so nonempty
member preservation is established by CI, not this production snapshot. Environment,
Compose, Nginx and PostgreSQL identity/start time remained unchanged. API/Web are
healthy, worker heartbeat is alive/idle, and no service restarted or OOMed.

Two release-helper interruptions are explicitly reviewed:

- Finalization stopped on one Web error: an invalid Server Action ID `x`. The
  corresponding request redirected from `/` and was rejected at `/login` with 404.
  The exact message/count and redacted request evidence are retained. Only that
  reviewed line was accepted; other errors still block finalization. No evidence
  of action execution or canonical changes was observed. This is not the earlier,
  unrelated Next stream-close observation and does not claim that issue fixed.
- Post-cleanup checks initially emitted an old short source label in their JSON,
  although actual runtime revision assertions passed. The helper now derives the
  label from its release directory and explicitly checks the current source. The
  read-only verification was rerun and passed. Application images/configuration
  were not modified by either helper correction.

After acceptance, pruning removed one older backup and retained exactly
**chat-reader-20261006T113958Z** and **chat-reader-20261006T141424Z**. Four replaced
25c7f6a image tags were removed, reclaiming **284,917,760 bytes** in that step.
Its verified recovery archive remains at
`/opt/chat-reader/releases/25c7f6a16f72780b08b22f1f3bf23665ebfd300c/chat-reader-images.tar.gz`,
SHA-256 `87f058fbc0797fd249d062fe6346b5b4bd9a2f694950726244642a1a950e2eae`.
Load it before rollback; no schema downgrade is needed. Final available space:
**15,477,846,016 bytes (14.41 GiB)**. No business volume or local residue was deleted;
no off-site or scheduled backup was added.

Final machine-readable provenance and production acceptance are in the audit evidence
directory. The stage is deployed and complete. The broad optimization goal remains
active; subsequent work requires a fresh audit, not replaying this release.
