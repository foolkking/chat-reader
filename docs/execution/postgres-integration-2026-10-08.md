# PostgreSQL integration — 2026-10-08

Remaining prerequisite audit: two external-fixture tests require the historical
real 398-message JSON/Markdown pair; another requires the supplied response-only
pair. Metadata-only inspection of the specified desktop examples directory found
two Markdown files and three ZIPs, no JSON pair. No import storage was inspected
or modified, and synthetic substitutes are not counted as real-fixture acceptance.
The file-symlink test remains skipped for unavailable Windows capability; no OS
settings or privileges were changed. At that checkpoint no loopback test service
was found and explicit startup approval had not arrived. The user subsequently
continued and specified local-only browser testing; approval is no longer the
missing prerequisite. The renewed execution-policy block is recorded in the
[latest local checkpoint](local-browser-acceptance-block-2026-10-08.md).

Status: 149 selected cases have passing evidence, zero skips. Local only.

Selection came from the full API gate's 148 PostgreSQL-dependent skipped cases
plus its repository-head database check. A newly created disposable database was
migrated to head on the task-owned PostgreSQL 17 cluster, with matching dump/restore
tools. Both integration opt-ins were enabled. Tests exercised real foreign keys,
concurrent transactions, migration roundtrips and archive restoration.

First gate: **148 passed, 1 failed**, zero skips, 644.79 seconds. The failed rescan
index test called the current seed against schema 0048; that seed now writes
`source_content_hash`, introduced by 0050. This was a test setup incompatibility.
The seed now runs at head before an actual downgrade to 0048. All original index,
upgrade/downgrade and data-preservation assertions remain. Both tests in that file
were rerun: **2 passed**, zero skips, 15.22 seconds (one overlaps the initial gate).
Do not describe the first run as 149 passes or count the overlap twice.

The main disposable database was dropped and its absence independently checked;
the task PostgreSQL supervisor exited successfully after stopping its cluster.
Temporary logs remain under desktop `wkkk/chat-reader-postgres-integration-20261008`.
Only aggregate test status and case names are retained in
`postgres-integration-2026-10-08-evidence/results.json`.

No product code changed in this stage. The earlier full API gate had 1,020 passes.
Of its 153 skips, these 149 are now covered; one unavailable symlink capability and
three external fixture cases remain unexecuted. Browser acceptance is still pending
the earlier startup rejection. No commit, push, CI, deployment or production access.
