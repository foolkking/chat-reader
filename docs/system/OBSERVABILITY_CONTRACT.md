# Observability Contract

## Scope

Release C adds low-volume operational evidence without an external telemetry
stack or a database migration. It covers API request correlation, lifecycle
events, aggregate diagnostics and storage visibility. It does not collect user
analytics or Reader performance telemetry.

## Request correlation

FastAPI generates a UUID for every request. Client-provided `X-Request-ID` is
not trusted or reused. The internal ID is available through request context,
is returned in `X-Request-ID`, and is included in the single structured request
completion event. Unhandled errors also return the same ID in an optional
`request_id` response field.

Request logging records only:

```text
timestamp, event, request_id, method, route_template, status, duration_ms
```

An unhandled error may add the exception class, but never its raw message. The
Uvicorn raw access log is disabled in deployed and Compose API startup so query
strings cannot bypass this policy. Logging is best-effort: serialization or
handler failure cannot fail a business request or worker transition.

## Privacy boundary

Structured logs and diagnostics must not contain message or conversation text,
Markdown source, attachment contents, user filenames, raw paths, request query
strings, Cookies, Authorization headers, Share tokens, cursor tokens, database
URLs, passwords or production secrets. Opaque internal request/job/artifact IDs
are permitted in lifecycle logs when needed for correlation. They are not used
as aggregate metric labels.

## Lifecycle events

Background jobs and imports emit one event for meaningful transitions:
started, committed, failed, cancelled, stale-recovered, retry-exhausted and
manual retry. Artifact publication emits staging, validated, published and DB
committed events. Cleanup emits aggregate apply results and cleanup failures.
Events contain category/type, state, attempt, bounded size/duration and opaque
internal IDs only.

Historical counters are intentionally derived from logs. Release C does not
add a metrics table. Current job/import state, retry exhaustion, queue age,
recent bounded timings, artifact records and task heartbeat age are derived
from existing database fields. There is no separate idle-worker heartbeat, so
an idle system is reported as `idle_or_unknown`, not falsely as healthy worker
activity.

## Diagnostics

`GET /api/internal/diagnostics` is disabled by default through
`ENABLE_INTERNAL_DIAGNOSTICS=false`. When disabled it returns 404. Enabling the
route is not sufficient production authorization: the external gateway/VPN
must also prove that the public path is inaccessible. If that boundary is not
confirmed, production keeps the endpoint disabled and administrators use:

```text
cd apps/api
python -m scripts.internal_diagnostics
```

Diagnostics returns aggregates only:

- job/import status, stale and retry-exhausted counts;
- oldest queue age and bounded recent timing samples;
- Export/Offline record counts and cleanup classification totals;
- imports/exports/offline/assets file counts and bytes;
- task-heartbeat age and configured scanner state.

The health endpoint remains cheap and unchanged. Diagnostics never reads
artifact contents or hashes files. Filesystem scans stop at 100,000 files and
return `complete=false` when truncated. SQL aggregation uses counts/groups and
a latest-500 timing sample; it does not load messages or attachment contents.
Cleanup classification first takes the bounded filesystem snapshot, then looks
up only matching `storage_uri` and artifact job IDs in chunks of 500. Historical
artifact references and unrelated jobs are never loaded merely because an
administrator requested diagnostics.

## Failure behavior

An unavailable metric degrades to an unavailable/incomplete aggregate. It must
not make ordinary API requests fail. Cleanup execution is a separate CLI and
is never triggered by a diagnostics GET.

## Current exclusions

Client cache hit telemetry, percentiles/alerts, external APM, Prometheus,
Sentry, OpenTelemetry collectors and a metrics database are not implemented.
No Alembic migration is introduced by this contract.
