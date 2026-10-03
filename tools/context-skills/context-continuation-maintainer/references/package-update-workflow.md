# OLD continuation state + NEW Raw snapshot

This workflow belongs to the reviewed repository runtime. It is not included in
the application's unchanged user-supplied default ZIP. Chat Reader does not run
these scripts or make semantic maintenance decisions.

Use NEW as the authority for Raw and attachments. OLD supplies the previous
Current/Index and stable identities. Both inputs remain unchanged. Publish only
one new `.context.zip`; work files are temporary, not extra user-managed state.

## Comparison and external reconciliation

Run:

```sh
python scripts/compare_context_packages.py OLD.context.zip NEW.context.zip
```

The report binds both inputs with `previous_snapshot_sha256` and
`new_snapshot_sha256`. These use `context-package-members-v1`: canonical JSON of
the profile plus a member-path map of SHA-256 and byte size. Manifest bytes and
supplementary members participate. ZIP compression/container metadata does not.
This is a separate binding from the unchanged message fingerprint profile.

The report distinguishes content changes, changed locators, added tail and
changed/missing attachment members. Equal message content is not proof that
notes, annotations, project context, attachment meaning or old conclusions remain
valid. Inspect supplementary changes and determine the maintenance boundary.

Prepare the existing structured Candidate and Trace contracts, binding
`source_binding.entrypoint_sha256` to NEW Raw, and
`source_binding.base_current_sha256` / `base_index_sha256` to existing OLD members.
Candidate base revision and Trace baseline revision refer to OLD. Add to Trace:

```json
{
  "package_update": {
    "previous_snapshot_sha256": "<comparison result>",
    "new_snapshot_sha256": "<comparison result>",
    "supplementary_context_reviewed": true,
    "repair_from_seq": 1
  }
}
```

Set review attestations only after actually doing the work. `repair_from_seq` is
required for historical changes inside the target coverage; choose an actual
boundary at or before the first changed message. Use REPAIR mode. Re-read the
affected suffix: later unchanged wording cannot inherit old semantic coverage.
The writer refuses inherited ranges at or after this boundary. It never computes
decisions, adoption, supersession or semantic closure for you.

For append-only updates, inherit only a validated old covered prefix, not all
unchanged old Raw. Read the old Hot Tail and new material through the chosen new
boundary. Locator-only reuse additionally requires deterministic unambiguous
mapping. Supply corrected Current evidence; Index KeyRefs resolve from explicitly
chosen sequences. Stale explicit references cannot pass merely because the newly
computed Raw fingerprints match.

## Materialization

```sh
python scripts/materialize_continuation.py NEW.context.zip \
  --previous-package OLD.context.zip \
  --candidate continuation-candidate.json \
  --maintenance-trace maintenance-trace.json \
  --output next-revision.context.zip
```

Do not pass `--validation-report` for dual-input materialization: the writer
constructs a private overlay of NEW Raw plus OLD Continuation and computes a fresh
report. It never trusts an OLD-only success report for NEW data. Optional `--fragment`
inputs remain source-bound and use the normal FINALIZE rules.

NEW may be Raw-only or carry byte-identical copies of OLD members. Different
Continuation in NEW is an explicit base conflict; choose the intended base rather
than silently overwrite one branch. Single-member OLD packages can be repaired
with full external acquisition; they are not complete verified baselines.

The writer pins semantic input files, checks Raw and every retained NEW member,
rechecks both input inventories before publication, and refuses existing output
paths including files created concurrently. Publication uses an exclusive
same-volume hard link; unsupported filesystems fail rather than overwrite a file.
No input package is modified. Failure removes temporary working copies and leaves
caller-owned inputs for retry. A retry must reconcile new input changes and use
fresh bindings. Never fix a stale-input failure by replacing hashes alone.

Schema/fingerprint checks remain deterministic evidence, not proof of semantic
truth. User/agent review must still establish the correctness of Current and Index.
