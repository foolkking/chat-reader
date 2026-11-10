# Reading tools and read-together workspace

Released **2026-11-09** with exact source `865b0a6`, full CI `42594459199`
and independent artifact/runtime checks. See
[Project State](../../PROJECT_STATE.md) and the
[release receipt](../execution/READING_INTERACTION_ZIP_RELEASE_2026-11-09.md).
Synthetic browser acceptance is not authenticated production or physical-device
acceptance; the original November 8 implementation/audit records remain historical.

## Unreleased image receipt presentation — 2026-11-10

The working-tree candidate expires only a successful image-size receipt three
seconds after its query-cache acknowledgement time. The scale trigger briefly
shows Saved (or a check icon for compact images), retaining the normal label's
geometry and accessible percentage. It adds no body row and covers neither the
image nor the slider. Virtual unmount/remount does not restart the deadline.
Expiration removes only that same receipt, never newer saving/error/unknown
state, confirmed dimensions or public-image settings.

Pending progress and unknown/error recovery do not auto-expire. The compact
slider keeps its percentage; save/publication guidance is available through
the trigger tooltip and group description rather than an added body paragraph.
The existing six-case slider gate additionally tests three-second success,
no receipt-driven geometry change, virtual remount and persistent uncertain/
pending states with a controlled clock. This candidate is not yet released.

## Reading-interaction behavior — deployed 2026-11-09

This section is deployed in `865b0a6`. Local synthetic verification is recorded in
[the implementation receipt](../execution/READING_INTERACTION_ZIP_FIXES_2026-11-09.md).
Exact-source CI, independent artifact and runtime acceptance are complete.
All three dispatches observed the 50-minute first-read boundary. No schedule or
real-user source replay was used. The required mounted Reader regression
supplements, not replaces, the original reading matrix.

- The header has title and, on its second line, the current message's canonical
  ordinal / complete conversation count, followed by tags. An unknown location
  displays `—`, never a loaded-window count or guessed ordinal. Clicking the
  title opens the existing tag editor; hover/focus has an accessible management
  hint. Desktop shows two tags, mobile one, with an overflow disclosure.
  Offline tags are read-only. Tag management remains in quick actions and
  `/tags`, not the primary left navigation.
- Focus mode permits the existing search drawer/sheet and attachment/annotation
  destinations without exiting focus or reopening the sidebar. Escape/close
  restore a live, visible opener without scrolling. Floating workspaces use
  the existing focus lifecycle in nonmodal mode; they do not trap body reading
  or consume Escape from a newer modal. New navigation and real user input
  retire the previous focus-width restoration before it can reclaim position.
  On mobile, the focus More menu opens above its controls inside the viewport;
  the controls reserve space for the two navigation edge buttons and can wrap.
  Keyboard help also opens above the whole wrapped toolbar, centered and bounded
  by the viewport minus the toolbar's actual height; its contents can scroll.
  Escape/close still returns to the help trigger without moving the document.
- A successful index/TOC jump emphasizes Return for three seconds; the top
  entry becomes ordinary, then hides at thirty seconds unless focused or busy.
  Its original checkpoint remains in More in normal/focus modes. A later
  successful jump renews presentation, not the origin. Failures retain their
  explanatory retry controls; auth/conversation changes retire timers/state.
  A separate single-flight guard remains busy through final exact restoration,
  not just target loading, and ignores late results from a retired identity.
- Messages with math and more than eight semantic display units use the
  existing block virtualizer. Math overscan stays eight; plain-text thresholds
  and adaptive overscan are unchanged. Detection is a memoized cost hint, not
  a Markdown rewrite. Tables/formulas, selection pins, block identities and
  source copying remain intact, including Share/Offline/Together renderers.
  Math rows use stable eight-slot sibling groups to bound style invalidation.
  Newly virtualized replies up to 160 units keep only empty shells for absent
  units; larger replies keep active groups only. Empty shells have no content,
  block identity or geometry. Measured gaps, selection pins and actual mounted
  rows remain owned by the existing virtualizer.
- Message hover affects only the operation toolbar's opacity. It does not
  reveal internal sorting fields or resize prose. Stable turn handlers preserve
  memo boundaries. Geometry samples reuse rectangles only within the same
  synchronous read; ordinary wheel bursts batch through the existing frame
  owner, while explicit navigation release/discrete layout compensation remain
  synchronous. No stale cross-frame rectangle cache is introduced.
- Opt-in `__chatReaderPerfProbe.markdownParseTotal` counts actual Markdown
  pipeline executions, not React render attempts, and records no content.
  KaTeX still emits MathML and retains its safety configuration.

## Image percentage and import default

- The large size dialog is replaced by a non-modal root-portal disclosure above
  its trigger: one slider and its percentage, no numeric field, preset row,
  nested menu, backdrop, mobile bottom sheet or second automatic-sizing mode.
  The opening viewport anchor stays fixed while a save rearranges images.
  Placement avoids Reader rails and clamps to the viewport. Escape returns to
  a still-live trigger without scrolling; outside interaction dismisses it.
- Fit column is adjacent to the scale action. Small images use labelled 44px
  icon actions that wrap independently of image pixels. The media does not
  enlarge to fit labels. Viewing is separate; read-only surfaces cannot save.
- Dragging changes only the draft. Release/keyboard completion submits once;
  cancellation before submission discards the draft. Closing cannot cancel
  an already submitted write. Shared source/auth-scoped write state prevents
  duplicate submissions and late reads replacing a newer confirmed save.
  Uncertain results require an explicit read-only check, never automatic retry.
- Adaptive-import confirmation optionally captures `image_lane_width`, a strict
  integer 44–8192, measured from actual Reader layout/preferences. The original
  commit snapshot is reused for retries. New authorized/scanned image
  attachments receive a concrete fitting percentage once, marked by optional
  `image_display_v1.origin: "import_fit"`. Manual save takes over the same field.
  Import-provided reserved geometry/display fields are not trusted.
- New manual uploads use the same bounded, once-only fit during authorized
  finalization (`image_lane_width`, 44–8192), from Files or Source Editor.
  Retries retain the client operation's measured lane; already committed items
  are returned unchanged. `origin: "upload_fit"` marks this default, not a
  second setting. A safety skip retains the original and additive
  `image_fit_warning`; it does not reject an otherwise usable upload.
- Conversion shares process admission and a nonblocking PostgreSQL transaction
  slot with API image/SVG conversions. Existing pixel/byte/format limits and
  import memory reserve/workspace limits are not raised. A savepoint isolates
  enrichment failure; derivative files are tracked by transaction cleanup.
  Unsafe, animated, unavailable or busy conversions retain the original and
  add a bounded import warning. Nothing is published automatically.
- Existing saved settings, old imports, previously uploaded images and archive/offline
  restores are not rewritten on read. Unconfigured originals still fit the
  body column through the existing natural layout; their public intrinsic size
  changes only after an explicit save. This is deliberately not a bulk migration
  or a promise to recompute saved sizes whenever the viewport changes.
  The unconfigured control says **Default fit**, with an approximate fitting
  percentage when safe geometry is available, and opens at that percentage.
  It does not label the default as saved 100%. The first gesture saves one
  concrete percentage; existing public output/offline copies are not silently
  rewritten merely by reading the default.

All other geometry, natural wrapping, full-image public output, folding and
Viewer rules in [the image contract](IMAGE_READING_STABILITY_CONTRACT.md) remain.

## Reader tools

- Wide primary actions: Search, Favorite, Save reading position, Annotations
  and bookmarks, Read together, Focus. A persistent More trigger owns a grouped
  vertical menu for content/data tools. Below 920px of actual toolbar width,
  Together and Focus move into More. Mobile uses vertical full-width rows.
- Canonical editing, Context, current files, sharing, exports and refresh remain
  available. Lineage and new-message controls are removed from Reader tools;
  their stored data and compatible APIs are not deleted.
- Tags are title metadata, not another right-toolbar item: two chips, overflow
  disclosure, quick add/remove, and a link to the dedicated `/tags` manager.
  Escape dismisses even when a submitted/disabled control loses focus to the
  page body, returning to the visible opener without scrolling. Nested details
  keep their own Escape owner; outside pointer/focus dismisses without taking
  focus back. Closing does not discard or replay an uncertain tag write.
  Existing paper/graphite/accent tokens, typography and 44px main targets remain.

## Together

- `/read-together` replaces the comparison UI. `/compare` redirects while keeping
  existing query parameters. This is simultaneous reading, not diff, merge,
  synchronized scrolling or version comparison.
- Alt+Shift+O opens the existing-search-backed chooser from owner Reader/Together.
  It is ignored during composition, editable focus or an active modal.
  Results are paginated and grouped by conversation. Choosing a title resumes;
  choosing a supported body/annotation occurrence preserves its locator.
  Other result kinds explicitly link to the full Reader rather than pretending
  to locate them in a pane.
- At most eight named tabs; at most two complete-turn bodies mounted. Two panes
  require 1052px (520px each plus a 12px divider); otherwise only the active tab
  mounts. Divider hit target is 44px; keyboard arrows resize and Home balances.
- Pane position and search state survive hiding/revisiting during the workspace
  session. Source identity/authentication generation fence async completions.
  Closing removes its snapshot; changing identity remounts the workspace.
  Refresh is not promised to restore the whole multi-tab session.
- Activation, choosing, closing the active tab and return/full-Reader navigation
  share the annotation workspace's leave guard. Unsaved local notebook/comment
  risk requires explicit consent; cancellation retains the original owner and
  draft. Concurrent departure requests do not stack confirmations. Authentication
  retirement still fences delayed decisions; this is not crash-durability.
- Pane search attachment/annotation results explicitly link to the full Reader;
  body results still use independent in-pane navigation. Keyboard activation and
  plain clicks use the same guarded dispatcher. The eight-tab limit is explained
  inside the chooser, not behind its modal.
- Each pane owns its DOM scroller and navigation lease. Shared real-block
  navigation returns geometry ownership before releasing virtual rows.
  New pointer/keyboard/scroll intent invalidates late remote navigation.
  Stale/ambiguous/missing targets do not claim precision. Message fallback is
  disclosed. No fake DOM IDs or global scroll restoration are introduced.
- Only active-pane genuine scroll intent can persist progress; passive fetch,
  image geometry compensation, resize and Viewer motion cannot. Explicit
  hand-off URLs preserve text anchors or non-text block offsets without writes.
  Search inputs have pane-specific identities. Bookmarks/annotations target the
  active conversation; selected-text copying remains available on read-only
  bodies. Image viewing cannot mutate saved image size.

## Bookmarks, annotation reading and portable documents

- Save reading position creates a normal `bookmark` annotation with
  `metadata.bookmark_kind: "reading_point"`, stable version/block identity and
  `reading_anchor`. Text excerpts use Unicode code points: up to 160 quote,
  120 prefix and 120 suffix. Non-text blocks retain pixel offset, not a fabricated
  character-zero location. Missing visible text is fetched through the same
  scoped Reader data source before creation.
  Capture measures real text-node line rectangles and binary-searches glyph
  boundaries rather than sampling only node endpoints. DOM UTF-16 offsets are
  converted to canonical code points; incompatible DOM/source text falls back
  to block-relative position without inventing an excerpt. This path is shared
  by Reader and Together.
- Saving the same confirmed point deduplicates in the UI, interactive API
  subject lock and offline edit transaction. Different non-text offsets remain
  distinct. Sync continues to use its original entity IDs/receipts. Legacy
  whole-message bookmarks remain readable; edited text anchors remap or become
  orphaned instead of falsely retaining valid coordinates.
- Save does not forcibly open the workspace. A status action opens the saved
  bookmark; read failures and uncertain writes are explicit. The workspace
  separates Annotations, Bookmarks and Notes. Cards prioritize saved comment,
  quote and source; context and editing/actions are disclosed separately.
  Changing tabs clears incompatible filters; explicitly viewing a saved bookmark
  reveals it regardless of an old query/type/color/current-message filter.
  Mobile and expanded reading provide Manage/selection; empty filtered/selected
  exports are disabled. Whole-message, text and non-text positions have distinct
  labels. Non-text cards and v2 exports show block-relative CSS pixels and any
  captured image label, never fabricated “Character 0”.
- Standalone `POST /api/conversations/{id}/exports/annotations` produces v2
  Markdown for all saved, current-filter, or selected IDs (max 2000 scoped IDs).
  English/Chinese include source identity/order, section, saved context,
  timestamps, stale-anchor warning and sign-in-required source links.
  Quotes/context use literal fences; headings escape imported text. Unsaved
  drafts are excluded. Filtered/selected counts are explicit.
- The offline equivalent uses only its Dexie snapshot, reports possible pending
  sync, uses the same byte-tested serializer/order and a 16 MiB output limit.
  Existing GET v1, `.cr` projection, packages v1/v2/v3 and Dexie v2 are unchanged.

## Private tags

- `/tags` supports finding, renaming, deleting, merging and viewing members,
  including a separate Archived view. Lists can assign/remove each selected
  tag across selected conversations without clearing unrelated memberships.
  Batch writes and competing list actions are interlocked.
- `POST /api/user-feature-entries/conversation-tag/{source}/merge` takes target
  ID and both revisions. Under the existing collection-lock order it validates
  union <=2000, unions memberships, redirects saved-search references, retains
  the target name, invalidates affected offline snapshots and deletes only the
  source tag. Stale revisions/ownership fail without partial writes.
- `GET /api/conversations?tag_id=...` uses the current owner's saved tag without
  requiring a search query. Delete/merge never delete conversations. Offline
  snapshots change only through explicit normal update, not online cache reads.

No migration, new image-processing dependency or replacement Viewer is added.
Verification status and remaining limits belong in
[the implementation record](../execution/READING_TOOLS_2026-11-08.md).
# Unreleased feedback recovery — 2026-11-10

Shared clipboard and citation success receipts expire after3seconds. Message
Markdown preparation/success stays in the existing action plus live-region
announcement, not a body-height-changing notice. Prepared text is retained;
retry does not regenerate public image links. Copy errors/manual fallback
remain visible until handled. Citation fallback actually focuses/selects the
field, and late message-version/account/unmount results are fenced.

A failed owner Markdown-copy preparation offers an explicit export of the
complete current message through the existing ordinary Markdown serializer and
new recoverable export control. It marks omitted attachments and does not
publish images; it neither truncates content nor pretends to repair unsafe SVG.
Previously created public links are not revoked by dismissing feedback.

Saved reading-position notices expire after5seconds without deleting annotations.
Keyboard focus pauses their remaining time; leaving the notice resumes it.
Saving, unknown-result and failed-read notices never auto-expire. Re-saving an
existing point refreshes only the success receipt. Notice controls remain44px;
mobile prose uses available width rather than a shrink-to-fit narrow column.
Local component checks are not full Reader/Share/Offline/Together acceptance.
