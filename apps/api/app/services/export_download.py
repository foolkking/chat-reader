"""Range-capable FileResponse with a lease bound to the actual ASGI transfer."""
import logging

import anyio
from fastapi.responses import FileResponse

from app.core.observability import structured_event
from app.services.export_retention import release_download, renew_download

logger = logging.getLogger(__name__)


class ExportFileResponse(FileResponse):
    def __init__(self, *args, session_factory, artifact_id, lease_id, **kwargs):
        super().__init__(*args, **kwargs)
        self.session_factory = session_factory
        self.artifact_id = artifact_id
        self.lease_id = lease_id

    async def __call__(self, scope, receive, send):
        async def keep_alive():
            while True:
                await anyio.sleep(15)
                if not await anyio.to_thread.run_sync(renew_download, self.session_factory, self.artifact_id, self.lease_id):
                    raise RuntimeError("Export download lease expired")

        # pathsend hands a filename to a server for later reading. Keep reads in
        # this response so completion really means the file is no longer needed.
        scope = {**scope, "extensions": {key: value for key, value in scope.get("extensions", {}).items()
                                          if key != "http.response.pathsend"}}
        try:
            if not await anyio.to_thread.run_sync(renew_download, self.session_factory, self.artifact_id, self.lease_id):
                from fastapi import HTTPException
                raise HTTPException(410, "Export download has expired. Generate it again.")
            async with anyio.create_task_group() as group:
                group.start_soon(keep_alive)
                await super().__call__(scope, receive, send)
                group.cancel_scope.cancel()
        finally:
            # Disconnect/cancellation must release too; DB outage falls back to
            # lease expiry instead of claiming physical reclamation succeeded.
            with anyio.CancelScope(shield=True):
                try:
                    await anyio.to_thread.run_sync(release_download, self.session_factory, self.artifact_id, self.lease_id)
                except Exception as exc:
                    structured_event(logger, logging.WARNING, "export_download_release_failed", error_class=type(exc).__name__)
