# Server storage review — 2026-10-05

Status: read-only inspection completed; no server cleanup performed. The user
asked what can be deleted, requires server business data to remain unchanged,
and does not want local Docker inspection or local image builds. Server backups
are also preserved under the current conservative boundary. Deployment uses the
already CI-built `5d48b68` artifact, not a new workstation image.

## Measurements

King's root filesystem is ext4, approximately 40 GiB. The latest inspection found
**3,236,964 KiB** available, below the existing approximately **5.03 GiB** release
preflight. Staging the new compressed artifact also consumes about 188 MiB; do
not count cleanup estimates as a successful preflight.

Server-side `old-image-cleanup.json` confirms that the previous release removed
four `5ef984a` tags and reclaimed **283,901,952 bytes** (about 271 MiB).
API, worker and migration tags share one image ID; their displayed sizes must not
be added as independent storage. The only remaining Chat Reader images are the
running `3f1d539` API/Web images. Deleted-but-open objects account for only about
16 MiB, not the multi-GiB shortfall.

## Reviewed candidates, not deletion authorization

| Candidate | Estimated reclaim | Conditions and consequence |
|---|---:|---|
| `/var/cache/dnf` | 216 MiB | Package-manager cache; use DNF cleanup, not package removal. Future package operations download metadata again. |
| Two old Chat Reader image archives | 375 MiB | Exact `chat-reader-images.tar.gz` files beneath release directories `0219fd5c5facfd6c57a5d651e74e7e58ff6b62eb` and `2863a00fadb500e6c2d8e206958de1edd947d50c`; neither is the current release or direct rollback. Preserve surrounding evidence and helpers. |
| Old VS Code Server installation | 625 MiB | `/root/.vscode-server/cli/servers/Stable-04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`; no process command, executable, working directory, mapped file or open descriptor references it at inspection. Keep the newer `Stable-07f806f999227108933c2e30515b26eecc1fda74`, active CLI and user settings. An old client may reinstall its matching server. Recheck references before deletion. |
| Archived systemd journals | About 600–640 MiB | Current journal usage is about 840 MiB. A 200 MiB retention target removes historical troubleshooting records; actual reclamation depends on active files and journal boundaries. Requires approval of reduced log retention. |
| Rotated system/login logs older than 30 days | 114 MiB | Six dated `messages-*` / `secure-*` files, totaling 119,284,636 bytes. Current logs and more recent history stay. Historical investigations lose those records. |
| Unreferenced images of other applications | About 274 MiB | `xream/sub-store:2.36.53` and `metacubex/mihomo:v1.19.28`; neither has a container reference, but that does not prove the operator no longer needs them. Confirm separately and preserve shared layers. |

The first three candidates total about **1.19 GiB**. Adding both log categories
could bring the estimate to about **1.9 GiB**, which may still be insufficient
after image staging. No broad Docker prune, direct overlay deletion, container
restart, swap removal or backup deduplication is part of this review.

## Preserved resources and next action

- `/opt/chat-reader/backups`: about **12.95 GiB**, preserved.
- Docker volume storage: about **3.91 GiB**, includes application data and databases.
- Current release `3f1d539` and direct rollback `5ef984a` image archives remain.
  The server's rollback instructions explicitly require loading the latter archive.
- `/www/swap` and `/swapfile` provide about 3 GiB of active swap. They are not
  disposable caches; about 365 MiB was in use at inspection.
- Other projects, panel runtime, credentials, production environment and live
  services are outside the cleanup scope.

The user has reviewed the candidate list but has not selected the newly proposed
cache/log/remote-editor cleanup. Wait for that selection or server expansion,
then recheck exact paths, links, references and free space. Resume the established
backup/load/migration/acceptance sequence only after its unchanged preflight passes.
The long-running goal is not complete: release and production acceptance remain.
