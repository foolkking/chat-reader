# Backup contents and retention review — 2026-10-05

Status: read-only server analysis. No backup, canonical row, artifact or service
was changed. No local Docker inspection or image build was performed. This is
an operational recommendation, not approval to remove backups or expired exports.

## What is occupying the server

`/opt/chat-reader/backups` contains ten deployment-recovery snapshots, from
2026-09-02 through 2026-10-05. Physical usage is **13,577,744 KiB** (about
**12.95 GiB**). These snapshots are PostgreSQL dumps plus four complete volume
archives, distinct from Docker images and from the application's `.cr` archive.

| Component | Latest compressed bytes | Approximate latest size | All ten compressed bytes |
|---|---:|---:|---:|
| `postgres.dump` | 193,660,873 | 185 MiB | 1,909,143,018 |
| `imports.tar.gz` | 120,576,746 | 115 MiB | 1,162,062,543 |
| `exports.tar.gz` | 1,167,316,029 | 1.09 GiB | 6,926,235,838 |
| `offline.tar.gz` | 167,087,373 | 159 MiB | 1,670,873,730 |
| `assets.tar.gz` | 335,944,191 | 320 MiB | 2,234,440,433 |

The latest snapshot is about **1.85 GiB**; exports account for approximately 59%.
Across all ten snapshots, exports alone occupy about **6.45 GiB**. Between the
September 27 and September 30 snapshots, the compressed export component grew
from 226,721,769 to 1,166,793,510 bytes.

Only archive headers and aggregate storage/SQL results were examined. Latest
imports contain source JSON/JSONL/Markdown and older imported containers;
offline contains 20 `.crpkg` objects; assets contains 301 object members plus
three small `.part` files. The PostgreSQL dump holds canonical application state.
No message body, user filename, account identity or token is included here.

## Verified duplication

All 27 files belonging to six duplicate groups were streamed through SHA-256
and matched their stored checksums. The groups include identical offline archives
in all ten backups, four identical older import archives, four identical older
export archives, and repeated asset archives.

- Redundancy above one physical copy per identical group: **3,817,643,603 bytes**
  (about **3.56 GiB**).
- Redundancy above two independent copies per identical group:
  **2,773,138,943 bytes** (about **2.58 GiB**).

These numbers describe byte-identical files, not semantically equivalent database
dumps. This review did not test a complete database restore or validate all unique
backup members. No hard links were created. Shared hard links must not be counted
as independent recovery copies.

## Why this grows

1. `deploy/backup.sh` creates a fresh PostgreSQL dump and full imports/exports/
   offline/assets archives for every invocation. It does not reuse unchanged
   components and never expires older backup directories.
2. The retention helper is a read-only report, not an enforced retention policy.
   Its defaults retain the newest three plus every other snapshot under 30 days.
   Applying those classifications to current metadata retains nine snapshots and
   marks only the oldest, about 573 MiB, for review. No matching Chat Reader backup
   or retention cron entry or systemd timer was found in the inspected host locations;
   the verified creation path is the manual/deployment backup helper.
3. The live ExportArtifact table contains 57 rows. **55 have expired**, totaling
   **1,118,251,449 bytes** (about **1.04 GiB**). The download endpoint rejects
   expired artifacts, but the cleanup classifier protects any DB-referenced path
   without an expiry exception. Each full backup copies this retained export
   directory again. The volume contains 87 ZIPs and six `.cr` files; gzip provides
   little reduction for these already compressed artifacts.
4. The existing aggregate cleanup dry-run completes and finds only 36 orphan
   files / **50,310,085 bytes** eligible. It does not authorize removing the expired
   referenced exports. Direct file deletion would bypass the lifecycle contract.
5. The documented host command for `backup_retention_report.py` fails on King's
   Python **3.6.8** with `future feature annotations is not defined`. The API
   container has Python 3.11.17, but its filesystem does not automatically expose
   the host backup root. The report needs a supported, explicit execution path.

## Recommended policy, not applied

- Keep pre-deployment consistent backups. After the new backup and release pass
  verification, retain a bounded set covering the current release, direct rollback
  and any specifically protected migration baseline. Do not add scheduled backups
  or silently delete snapshots based only on age.
- As a size illustration only, the newest three current snapshots total
  **5,953,802,709 bytes** (about **5.55 GiB**); all others total about **7.40 GiB**.
  Actual deletions must account for recovery ownership and protected migration
  points. This is not a deletion list.
- Give expired export artifacts an explicit lifecycle with grace, in-progress
  download/job protection, DB/file coordination, retries and a visible rebuild
  path. Preserve canonical conversations, attachments and current offline copies.
  Removing all exports from existing backup/restore contracts without adapting
  those references would be incorrect.
- Then separate regenerable delivery artifacts from essential recovery data in
  future backup formats, and consider content-based reuse for unchanged large
  components. Keep restore compatibility and test actual recovery first.
- Make retention reporting runnable on the host, expose retained/eligible bytes
  and protect current/rollback references. Disk-space preflight remains enforced.
- Keep at least one verified recovery copy on independent storage if host/disk
  failure recovery is required. Multiple full copies on the same disk do not
  provide that independence.

The user has asked for diagnosis only at this point; existing server data and
backups remain unchanged. The release capacity block is not resolved by this report.
