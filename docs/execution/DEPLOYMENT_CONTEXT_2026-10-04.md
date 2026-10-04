# Context and settings deployment — 2026-10-04

Production `https://chat.king.2bd.net` runs source
`0219fd5c5facfd6c57a5d651e74e7e58ff6b62eb` from successful
[Actions 37143028696](https://github.com/foolkking/chat-reader/actions/runs/37143028696),
attempt 1. API, Web, settings, image build and independent artifact inspection all
passed. This completes the deployment preceding the user's separate whole-site
UX audit; none of the earlier settings or release fixes count toward its 15 items.

## Provenance and verification

| Item | Result |
|---|---|
| GitHub outer artifact SHA-256 | `729354bbe366ccd66b21be4be675c79a4310c449a7a6e07ee2033a4cc20b6980` |
| Transfer | 195,326,238 bytes; GitHub digest and size match; streamed to King |
| API/worker image | `sha256:8bfce3dd8ec5b9c6c8c860c2da84b7a83479c7faf2cba0021e4945a9141f3a51` |
| Web image | `sha256:78a79bf4ee6536bda50556d00ef454a6b27ae82c259948cba959e7b9c80d74da` |
| Migration | 0042 → **20261003_0046**, single head/current |
| Verified five-component backup | `/opt/chat-reader/backups/chat-reader-20261003T183717Z` |
| Previous image revision retained | `ad223cd4bcbbad7a4ff0c5ea5f33ed2846f3a3ca` |
| Release support/provenance | `/opt/chat-reader/releases/0219fd5c5facfd6c57a5d651e74e7e58ff6b62eb/` |

The artifact contains three root files and one diagnostics gateway member. After
checking the trusted outer digest, deployment recorded per-member SHA256SUMS;
these are locally derived verification records, not an extra CI-signed manifest.
The optional diagnostics gateway was not published. Only the scoped Context/Skill
upload snippet was added, with Nginx syntax validation and reload.

Capacity preflight passed: approximately 8.53 GiB available against 5.03 GiB
required for backup, image expansion and headroom. API/worker writes were stopped
for a consistent backup; PostgreSQL was neither stopped nor recreated. Backup
checksum, archive and database readability checks all passed before migration.
Only prebuilt API, worker and Web services were replaced with `--no-build`.
Production environment checksum, administrator deployment configuration, and
PostgreSQL container identity/start time remained unchanged. Live Compose was
preserved: its differences were unused local build revision arguments.

Before/after canonical counts match, with all 301 attachment files SHA-256 checked
and zero integrity issues. Personal Skill bytes/identity/status and explicit
selections were also compared through aggregate digests; both tables currently
contain zero rows in production. Nonempty personal data preservation is proven
by the separate synthetic integration tests, not by that empty production check.

## Tests and actual production acceptance

- CI API: **868 passed / 3 skipped**; shared runtime 64 passed; Context API 53 passed.
- CI settings: **126 passed**, plus **1** independent fresh-instance archive restore.
- CI Web: Context 30, focused Reader/security 45, PDF 5, authentication 18 and
  offline negative 17 passed; other Share/source/upload/Markdown gates also pass.
- CI default PWA: **134 passed / 250 mode-specific skips**. The relevant optional
  suites run in their dedicated gates; skips are not counted as passes. Adaptive
  Import has 3 passed / 1 absent external-fixture skip. Overlapping totals are not added.
- Authenticated production HTTP: real login, twelve read-only settings/capability/
  runtime requests, build revision, logout and subsequent private 401 all pass.
- All three public default Skill ZIPs match their pinned bytes and download headers.
  Both 12 MiB unauthorized Context/Skill requests return 401 after recheck.
- Actual authenticated production browser: account/security, help and Skill settings
  work at **375 / 768 / 1440px**, without horizontal overflow or page errors. No
  application content or preference was changed. The smoke session was revoked,
  and private access after logout returned 401.
- API/Web/PostgreSQL healthy; worker heartbeat `alive_idle`, zero processing jobs.
  No restart, OOM or startup error lines. Current/rollback pointers verify.

Production browser acceptance above is deliberately scoped to read-only settings.
Full production Reader mutations, external AI Skill use and semantic continuation
quality are not claimed; isolated functional suites and synthetic semantic review
retain their own evidence scope. SMTP remains unconfigured in production.

## Failed attempts retained

1. Initial extraction preflight assumed all artifact members were root-level; it
   stopped before extraction on the expected `deploy/` member. Exact CI member-list
   verification resolved this without a service change.
2. The read-only migration probe was initially mode 0600 and unreadable to the
   non-root API container. It failed before migration. Only that non-secret helper
   became 0644; the complete comparison/migration sequence then passed.
3. Immediately after gateway reload, the first 12 MiB unauthorized public probe
   returned 502. Services remained healthy with zero restarts. Direct API and
   public 1 KiB/12 MiB probes returned 401; the original entire Bundle/upload
   script then passed. The initial transient is retained, with no confirmed root
   cause; it is not rewritten as a pass or hidden with automatic test retries.

No images, backups, volumes, user files or production configuration were broadly
cleaned. The previous rollback pointer was preserved in the release directory.
Schema downgrade requires reviewing Bundle uniqueness constraints and the verified
backup; image rollback alone does not undo a database migration.
