# ChatGPT reading and noise precision release — 2026-10-25

## Authority and scope

The user authorized completing the remaining reading work, implementing the
noise precision review, then submitting/deploying both as one batch. No new
optimization cycle or private-sample adapter was authorized. No web search was
used for this release.

- Reading: display policy v7, safe visible HTML fallback, nested-code protection,
  full import warnings, bounded rendered/source mapping previews, Mermaid text
  alternatives and exporter-v6 rejection of non-string `say`.
- Noise: preserve intentional literal edge whitespace through trial/save/rescan;
  reject all-whitespace rules; bound/interleave samples across messages and show
  actual match modes without relaxing protected-candidate confirmation.
- Canonical text, Share URLs, `.cr`, offline v1/v2/v3, Dexie and migration
  contracts remain unchanged. No historical text reconstruction or batch reimport.

Implementation and original local limitations remain in the
[reading continuation](CHATGPT_READING_REMAINING_2026-10-25.md) and
[noise audit](ux-audit-noise-matching-2026-10-25.md).
The pre-existing generated `apps/web/tsconfig.tsbuildinfo` remains excluded.

## CI and independent artifact verification

Implementation commit `571eb7a` initially ran full CI `40194910918`; it failed
and was not deployed. The two stale browser assumptions were corrected in
`c7dc074`: recovery now expects the intentionally whitespace-preserved literal,
and new-conversation tests locate both message inputs by localized placeholder
instead of textarea order and verify both drafts survive failed saves.
No product protection, assertion purpose or release gate was disabled.

| Gate | Verified result |
| --- | --- |
| Exact released source | `c7dc0749e3ba18394cb0a37b8d66e9f01837c5a8` |
| Workflow | `Build release images`, run `40199643009`, attempt 1 |
| Jobs | `web-quality`, `api-quality`, `settings-quality`, `build-images`, `inspect-release-artifact`: all success |
| Wait/read boundary | Run created 13:52:55 UTC; verified read 14:54:05 UTC, after the required 50-minute wait |
| Official artifact | `12603110915`, bound to this exact source/run/attempt |
| Image archive SHA-256 | `2d27a8c07da062e7d25f84de7f8d26ab18c60973b597051015551d492a12f6ec` |
| Independent inspection | 35 hashed blobs, 344 exact-source files, 21,339 layer entries; forbidden paths absent |
| Compiled behavior | Exact API/Web revision, v7 reading, noise match modes and prior safety markers verified |
| Support files | Exact-source LF deployment support archive and ten transferred-file hashes verified |

The OCI descriptor chain, linux/amd64 configs and layers were checked, not just
manifest strings. API/worker loaded config identity is
`sha256:c7ee77ee085a0859b1fe27627c7c24c492221c5725f9ce0f07e2922ddb679e5e`;
Web is `sha256:c82de7146fe8b734a190ec1d95cde1b6d7120adb1f681b42fb1eec8ea0b15461`.
These correspond to the verified official manifest descriptors
`sha256:43bdee0ce626cbc7d610b399f3fd1ed324a06a2810e05ea8b760deb5f96514f9`
and `sha256:a87789cb7d9c173c0c62a74dcba9516641b5bbb197be1b38dda7c5e238123698`.

## Preflight, backup and deployment

Production initially ran `3fbf79d`, direct rollback `18d4971`, at schema
`20261022_0053`. Runtime/source identity, rollback images, zero admitted
background/import work and capacity passed before maintenance. Exact-source
space preflight reported 5,124,080 KiB available / 4,013,051 KiB required;
no cleanup was used to make the check pass.

Only Web/API/import-worker were stopped. PostgreSQL remained running.
The stopped-writer check required at least 448 MiB available memory, unchanged
PostgreSQL/config and idle work. The bounded, read-only attachment-storage
verification passed before backup. Five-component backup
**`chat-reader-20261025T145945Z`** includes PostgreSQL custom dump and
imports/exports/offline/assets archives; all checksums, database TOC and archive
checks passed before image replacement.

Only the verified CI images were loaded. Read-only, resource-bounded migration
checks confirmed the single head/current `20261022_0053`; no upgrade or
downgrade ran. Canonical row counts stayed unchanged while writers were stopped.
The existing public-image privacy gateway matched the approved location and
passed verification without configuration write or reload. Application services
were recreated with `--no-build --no-deps`, never with the check-only overlay.

**Maintenance: 14:59:28–15:08:17 UTC / 22:59:28–23:08:17 +08:00.**
This was planned downtime, not a zero-downtime rollout.

## Accepted runtime and recovery

Production accepted at **2026-10-25 15:08:17 UTC / 23:08:17 +08:00**:

- API/Web healthy; worker heartbeat fresh; all three exact revisions/images
  match the independently verified artifact. Zero application restarts/OOM.
- Local API/Web health, HTTPS health/login: 200; HTTP redirects to HTTPS: 301.
  Anonymous capabilities/copy/image-display: 401; diagnostics and missing public
  image capability: 404. Approved privacy/no-store checks passed.
- PostgreSQL identity/start time, production env/Compose and Nginx unchanged.
  Scanner remains disabled and complex attachment preview disabled.
- Startup error-keyword counts zero for all three application services;
  no new kernel OOM lines and host `oom_kill` counter unchanged at 487.
- Current/direct rollback pointers verified as **`c7dc074`/`3fbf79d`**, both at
  0053; rollback does not require database downgrade.

A **15:11 UTC / 23:11 +08:00** lightweight recheck confirmed health,
`alive_idle`, release pointers, zero restarts/OOM and unchanged PostgreSQL;
free disk was 4,171,018,240 bytes (about 3.88 GiB).
Full operator receipts remain in this release's protected `attempt1` directory;
only nonsecret aggregate facts are recorded here.

No production/local application image build, PostgreSQL restart, env/Compose/
Nginx overwrite, operational-checkout reset, import/user-data/volume deletion
or backup/image pruning occurred. Source-specific old failures/skips are retained,
not recounted as passes. Authenticated production UI, real-user false-positive
rate, physical clipboard/device, screen reader and sustained-load acceptance
were not performed.
