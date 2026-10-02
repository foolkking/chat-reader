# Observability Contract

## Scope

## In-app help and administrator runtime status (2026-10-02, not deployed)

Personal settings and Offline Library share **Help & diagnostics**. It shows
the authenticated API connection, API version/build, the Web build, a guarded
inspection of this account's existing startup cache, the offline authorization
expiry, effective account limits and task-specific FAQ. Reading this panel does
not register a worker or download resources. Capability snapshots use the
existing account-bound Dexie v2 settings table; offline/failed refresh values
are explicitly last-known, never current. A generation fence surrounds cache
reads and writes. Expiry removes the panel with the private workspace; another
account cannot read or claim the snapshot. Package formats remain unchanged.

Diagnostics are generated only by the explicit copy action. The serializer
constructs a new fixed schema with validated enums, numbers, version/revision
strings and timestamps. It never serializes API objects, exceptions, shell
messages/missing-resource paths, account identifiers, filenames, content,
URLs, environment configuration, cookies or credentials. Copy failure keeps
the text selected for manual copying. Nothing is uploaded automatically.

`GET /api/app-info` is authenticated and non-cacheable. It returns only
`api_version` and the immutable image build `revision` (or null when unknown).
The existing `/api/health` three-field contract is unchanged. Release images
embed the full lowercase 40-character Git revision at build time; runtime
environment values do not replace it. See the deployment contract.

`GET /api/admin/runtime-status` is Root-only (ordinary accounts receive 404),
non-cacheable and read-only. It returns worker liveness, fixed job/import status
counts, storage summaries, latest system backup/restore statuses and mail
configuration presence. No names, IDs, payloads, errors, storage keys, addresses
or paths are included. This is a separate application service, not a proxy for
the loopback operator endpoint below.

Each PostgreSQL metric has a 1.5-second statement timeout and savepoint so one
failure does not poison later metrics. Local storage scans count at most 10,000
directory entries per root and use a 150ms cooperative time budget (an individual
filesystem call can still block). They never read file contents. Missing roots,
errors and partial scans are explicitly unavailable/incomplete. Object storage
shows database object-record count/logical bytes, not measured remote usage.
No/future heartbeat is unavailable; stale heartbeat is labelled stale, even
when metrics are complete. Mail configured does not imply tested delivery.
Latest archive status is derived without updating the backup record.

The administrator panel refreshes every 30 seconds while visible, pauses when
hidden and refreshes on return. A failed refresh retains the last result with
an outdated warning. No cleanup, restart, automated backup or notification
action is added. Tests and dated execution evidence distinguish these snapshots
from operational remediation and production validation.

## Existing operator observability

The current contract combines the Release C request/logging and bounded
aggregate diagnostics baseline with the Release L worker-liveness and protected
operator-access closure. It does not collect user analytics, Reader telemetry,
or business content.

## Request correlation and logs

FastAPI creates a server-owned UUID for every request. It is returned as
`X-Request-ID` and included in one structured completion event. Client request
IDs are not trusted. Raw Uvicorn access logging is disabled so query strings do
not bypass redaction.

Request logs contain only bounded operational fields: timestamp, event,
request ID, method, route template, status, duration and, for the principal
conversation, TOC, search and Files Panel read routes, a fixed endpoint family
and duration bucket. They never contain raw exception messages,
credentials or business content. Logging is best-effort and cannot fail a
business request or worker transition.

## Privacy boundary

Logs and diagnostics must not contain message or conversation text, Markdown
source, attachment contents or filenames, full storage paths, raw job payloads,
query strings, Cookies, Authorization headers, Share/cursor tokens, database
URLs, passwords or environment secrets. Aggregate counts, byte totals, bounded
timings and configured operational modes are allowed. Opaque IDs may appear in
transition logs when needed for correlation, but never as unbounded metric
labels or in diagnostics output.

## Worker liveness

The single production worker owns the `worker_runtime_states` row keyed by
`primary`. A process instance registers immediately, publishes an independent
heartbeat every 30 seconds and records `idle` or `busy` plus only the task
family (`import` or `job`). The row contains no task ID or payload. A heartbeat
is stale after 120 seconds, allowing four missed intervals and normal scheduling
jitter.

The heartbeat runs on a worker-owned background thread and continues while the
main worker thread executes a long synchronous task. Worker liveness commits
before a separate best-effort active-task heartbeat update, so a task-row
failure cannot roll back proof that the process is alive. A replaced instance
cannot overwrite the current instance row and stops claiming new tasks after
detecting replacement.

Diagnostics derives these server-time states:

```text
recent heartbeat + idle = alive_idle
recent heartbeat + busy = alive_busy
heartbeat age >= stale threshold = stale
no worker row = unavailable
```

Job/import completion timestamps never prove process liveness. Processing task
counts and the most recent task heartbeat remain separate aggregates. This
distinction permits an orphaned processing row to coexist with an accurately
reported idle/stale worker state.

## Protected diagnostics

`GET /api/internal/diagnostics` is omitted from the public OpenAPI schema and
requires both controls:

1. `ENABLE_INTERNAL_DIAGNOSTICS=true` in the API/worker environment.
2. A loopback API client (`127.0.0.1` or `::1`).

The production Nginx exact-prefix location always returns a concealed 404 for
the diagnostics path and never proxies it to Next.js. The authorized operator
path is the existing SSH public-key boundary followed by a request made inside
the API container to its loopback listener. There is no public HTTP credential,
hidden-link authorization or frontend entry.

Both denied and successful responses are non-cacheable. Successful responses
also carry `Pragma: no-cache`, `X-Content-Type-Options: nosniff`,
`X-Robots-Tag: noindex, noarchive` and the normal server-owned request ID.

Diagnostics returns only:

- worker state, heartbeat timestamp/age, task family and processing count;
- job/import status, stale, retry-exhausted, queue-age and bounded timing data;
- recent queue-wait and execution samples include fixed p50/p95/p99 percentiles
  alongside their averages and histograms; the sample remains capped at 500;
- Export/Offline record and cleanup classification aggregates;
- imports/exports/offline/assets file counts and byte totals;
- configured Scanner mode (`disabled` remains `disabled`, never `safe`).

The public `/api/health` endpoint stays coarse and separate. Diagnostics is
read-only, triggers no cleanup or remediation, hashes no files and caps its
filesystem scan at 100,000 entries and recent timing sample at 500 rows.

## Failure behavior

A heartbeat or metric write failure is rate-limited in logs and must not expose
payload data. An unavailable metric degrades to unavailable/incomplete rather
than failing ordinary API traffic. Release L detects stale workers but does not
restart, kill, scale or otherwise remediate them automatically.

## Persistence and configuration

Alembic revision `20260816_0022` adds only the bounded singleton operational
state table. It does not change canonical conversation, attachment, Offline,
Dexie or package formats. `WORKER_HEARTBEAT_STALE_AFTER_SECONDS` must be at
least three times `WORKER_HEARTBEAT_INTERVAL_SECONDS`.

External APM, Prometheus/Grafana, alerting, automatic remediation and a general
metrics database remain out of scope.
