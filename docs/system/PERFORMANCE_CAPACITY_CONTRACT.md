# Performance and Capacity Contract

This contract defines how Chat Reader capacity is measured and how the results
may be interpreted. It does not promise unlimited conversation size and it does
not authorize production stress testing.

## Measurement boundary

- Large fixtures run only in an isolated Linux stack with PostgreSQL, API,
  worker, production Web build, and Chromium.
- King production is limited to health, resource, version, and lightweight
  read-only checks. Synthetic 10k import, restore, CPU, and memory-pressure
  tests are prohibited there.
- Fixtures use seed `20260814` and fixture version
  `release-d-reader-capacity-v1`. They contain no user content.
- Raw evidence belongs to the corresponding GitHub Actions run. Test and build
  caches downloaded locally belong in an operator-designated directory outside
  the repository.
- Three browser cold runs are reported with median and worst values. Warm
  revisit is measured separately.
- Each capacity case also writes its complete unfiltered measurement JSON to
  the uploaded test-output directory before assertions. A body-only Playwright
  attachment is not durable evidence with only the list/gate reporters.
- API and worker RSS are sampled from Linux `/proc` every 50 ms. This is a
  combined process working-set measurement, not a user-device memory promise.
- System archive restore runs in a fresh isolated PostgreSQL database.
- Query decisions use `EXPLAIN (ANALYZE, BUFFERS)` against deterministic
  synthetic data. A sequential scan alone is not evidence for an index.

## Fixture profiles

| Profile | Contents |
| --- | --- |
| Plain | Bounded Chinese/English-equivalent text, headings, and lists |
| Math heavy | Inline/display math plus aligned, fraction, root, sum, and integral shapes |
| Mixed rich | GFM tables, code, math, footnotes, blockquotes, and nested lists |
| Attachment metadata | One distinct business Attachment per 100 messages, one shared 23-byte AssetObject, and one current occurrence per Attachment |
| Large message | Ten messages with five bounded messages of about 1.35 MB each |

Reader/import/export tiers are 398, 1,000, and 10,000 messages. System `.cr v4`
uses current-like (398), 2x (796), and 10x representative (3,980) tiers. The
10k tier is characterization, not the default supported-range promise.

## Reader budgets

The historical far-target Reader gate remains unchanged. Release D adds a
separate first-window capacity gate without weakening that history:

- frame interval p95: at most 34 ms;
- longest long task: at most 150 ms;
- five-second long-task total: at most 250 ms;
- mounted messages: at most 40 in the capacity first-window workload;
- mounted virtual blocks: at most 120;
- no page-level horizontal overflow;
- real reading movement may not reverse by more than 2 CSS pixels;
- no blank window or overlapping virtual rows.

The first-window bound is not substituted for the stricter settled far-target
bound in `reader-restoration.spec.ts`.

### Reading coordinates — measurement v4

The original thirty 120px wheel inputs and 34ms sample delay remain unchanged.
Direction is measured from a shared, still-connected real DOM block/article
relative to the Reader viewport, both on every animation frame and at every
wheel sample. Candidates are ranked by the previous reading line, not by a
favourable new delta. A reused ID after remount or version replacement does not
establish continuity. Missing visible/shared anchors are unknown and fail.
Neither settled/compensating flags nor a changed scrollHeight excuse a reverse.

Whole-turn reclamation can legitimately rebase raw scrollTop while retaining
the actual reading anchor. V4 retains all original raw wheel samples/reversal
records, adds every frame's raw coordinates and physical-anchor evidence, and
reports raw monotonicity separately. It also catches a real backwards movement
undone before the next wheel sample. The 2px tolerance is unchanged; no failed
frame, >=1s freeze or long task is discarded. Chronological frame intervals
and all long-task durations are preserved before a copy is sorted for p95.

This is a measurement correction, not a product scroll writer, pin, spacer,
longer reclamation delay or relaxed capacity budget. The identical single-file
harness is used on both historical baseline and candidate. Mounted synthetic
coordinate/negative controls supplement the original complete Linux workloads
and stability matrix; their deliberate quiet pause is not in the release
capacity workload. Older v3 diagnostic evidence remains unchanged and does not
prove that an unexplained cold long task has been fixed.

## Same-runner release gate

The candidate must pass every listed Reader assertion and unchanged budget.
The immutable historical baseline runs on the same runner with the same
measurement harness; its exact pass/failure result and telemetry are retained
as comparison evidence but do not veto a candidate that independently passes.
This keeps a pre-existing baseline correctness defect from preventing a
verified candidate repair from reaching artifact checks. Baseline checkout,
service startup, build, missing evidence or other harness/infrastructure
failures still fail the comparison workflow. Neither phase is skipped, and a
baseline assertion failure is not relabeled as a pass.

For an unexplained failed budget, manual Reading performance comparison accepts
an optional full lowercase `diagnostic_ref` SHA. It runs the same baseline and
that exact failed source through all nine cases in original order, adding per-cold-run CPU
profiles and browser metric snapshots. The artifact and payload explicitly say
**diagnostic only**. Profiling affects timing; no result from this opt-in run is
release acceptance or replaces the original failure. The normal reusable
workflow has no diagnostic input, runs all nine cases, and retains every
original threshold/assertion. No profiling is installed in the product.

## Cache interpretation

The browser probe is installed only by Playwright and counts Rich Markdown
renderer invocations and math-bearing source units. It records no source text
and sends no telemetry. React memoization keeps mounted unchanged blocks stable;
unmounted blocks may parse again on revisit because no persistent generated-HTML
cache is part of the canonical contract. Revisit counts are therefore evaluated
together with frame, long-task, memory, and correctness budgets. KaTeX HTML is
never written to PostgreSQL.

## Capacity classes

- `NORMAL_SUPPORTED_RANGE`: 398-message representative workloads that pass all
  correctness and resource budgets.
- `LARGE_SUPPORTED_RANGE`: 1,000-message representative workloads that pass,
  while requiring more elapsed time than normal conversations.
- `CHARACTERIZED_ONLY_RANGE`: 10,000-message and 10x archive workloads. A pass
  proves bounded behavior in the measured environment, not a general SLA.
- `UNCHARACTERIZED_RANGE`: larger data, substantially larger attachments,
  highly concurrent exports, and few-message/multi-gigabyte sources.

`WARNING` means the workload remained correct and bounded but has limited
headroom or user-visible elapsed time. `FAILED` is reserved for correctness
failure, OOM/process death, unhealthy PostgreSQL/worker, unbounded memory/DOM,
or a frozen budget regression.

## Optimization and index gate

Product code changes require a reproducible budget failure, a localized root
cause, and before/after measurements from the same fixture and environment.
Large files, `.all()`, React renders, or sequential scans are not independently
sufficient reasons to refactor. A database index additionally requires a
high-frequency or critical query, meaningful budget contribution, an improved
measured plan, acceptable write/storage cost, and a rollback proposal. Release
D adds no migration unless that evidence is separately approved.

## Product invariants

Performance work must preserve canonical mutation revision handoff, Reader
position and navigation, full MathML and KaTeX safety, Attachment identity,
Offline package v2, Dexie v1 reading, artifact transaction safety, `.cr v4`
bytes/semantics, request-ID privacy, and cleanup protection.

Detailed Release D results are recorded in
[`PERFORMANCE_CHARACTERIZATION_REPORT_2026-08-14.md`](../evidence/PERFORMANCE_CHARACTERIZATION_REPORT_2026-08-14.md).

## Local body-retention regression — 2026-10-19

The [local import/export follow-up](../execution/OOM_IMPORT_EXPORT_FOLLOWUP_2026-10-19.md)
compares current source with exact baseline `f3b331a` on a small synthetic
129-message/three-version SQLite fixture. Weak references measure live body
entities and `tracemalloc` measures Python allocation; native PostgreSQL tests
separately exercise cursors/COPY and snapshot consistency.
This is a localized allocation/correctness regression, not a new capacity class,
RSS benchmark, Linux stack test or 2 GiB/60-minute acceptance. Smaller batches
can increase query/elapsed costs; the micro timings are not throughput promises.
No production workload, configuration or deployment was changed during those
local measurements. The repair later shipped in
[50f6de4](../execution/OOM_RELEASE_2026-10-19.md); deployment does not turn the
micro measurements into production capacity or long-load acceptance.

The [next continuation](../execution/OOM_SEARCH_GZIP_FOLLOWUP_2026-10-19.md)
separately measures attachment metadata and annotation-index retention against
its pre-continuation local snapshots. Gzip uses a bounded synthetic expansion
and zero/ample memory probes; rejection before decoding is not an induced OOM
or a Linux capacity result. Output equivalence and actual PostgreSQL
join/delete/rollback tests accompany the allocation results. No new capacity
class or throughput promise is inferred, and the 2 GiB/60-minute gate remains
unexecuted.
