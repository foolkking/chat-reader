# Observability Contract

## Scope

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
