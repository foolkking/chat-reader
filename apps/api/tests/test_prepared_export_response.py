"""Real temporary downloads close on completion, disconnect and failed preparation."""
import errno
from tempfile import SpooledTemporaryFile

import anyio
import pytest
from starlette.requests import ClientDisconnect
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models.conversation_event import ConversationEvent
from app.schemas.export import StreamingExportResult
from app.services.export_download import PreparedExportResponse
from app.services.exporting import prepared_export
from app.services.exporting.prepared_export import PreparedExportContent
from test_import_preview_api import client  # noqa: F401
from test_message_editing_api import commit_edit_sample


@pytest.mark.parametrize("failure", [None, "headers", "body", "disconnect"])
def test_temporary_download_is_closed_on_every_response_exit(tmp_path, failure):
    data = b"synthetic download\n" * 9000
    stream = SpooledTemporaryFile(max_size=64, dir=tmp_path, mode="w+b")
    stream.write(data)
    stream.seek(0)
    response = PreparedExportResponse(StreamingExportResult(
        content=PreparedExportContent(stream, len(data)), media_type="application/octet-stream",
        filename="Synthetic download.txt", message_count=1,
    ))
    sent = []

    async def run():
        async def receive():
            if failure == "disconnect":
                return {"type": "http.disconnect"}
            await anyio.sleep_forever()

        async def send(message):
            if failure == "disconnect":
                await anyio.sleep_forever()
            if (failure == "headers" and message["type"] == "http.response.start" or
                    failure == "body" and message["type"] == "http.response.body"):
                raise OSError("Synthetic disconnected client")
            sent.append(message)

        scope = {"type": "http", "asgi": {"spec_version": "2.0" if failure == "disconnect" else "2.4"}}
        with anyio.fail_after(5):
            await response(scope, receive, send)

    if failure in {"headers", "body"}:
        with pytest.raises(ClientDisconnect):
            anyio.run(run)
    else:
        anyio.run(run)
    assert stream.closed
    assert not list(tmp_path.iterdir())
    if failure is None:
        assert b"".join(item.get("body", b"") for item in sent) == data
        assert sent[-1]["more_body"] is False


@pytest.mark.parametrize("failure", ["create", "write"])
def test_storage_failure_returns_retryable_error_without_export_event(client, monkeypatch, failure):
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    created = []
    original = prepared_export.SpooledTemporaryFile

    def full_storage(*args, **kwargs):
        if failure == "create":
            raise OSError(errno.ENOSPC, "Synthetic full storage")
        stream = original(*args, **kwargs)
        created.append(stream)
        def fail_write(_):
            raise OSError(errno.ENOSPC, "Synthetic full storage")
        stream.write = fail_write
        return stream

    with monkeypatch.context() as patch:
        patch.setattr(prepared_export, "SpooledTemporaryFile", full_storage)
        response = client.get(f"/api/conversations/{conversation_id}/exports/canjson")
    assert response.status_code == 503
    assert "try again" in response.json()["detail"].lower()
    assert "Synthetic full storage" not in response.text
    assert all(stream.closed for stream in created)
    events = client.get(f"/api/conversations/{conversation_id}/events?event_type=conversation_exported").json()
    assert events["total"] == 0
    retry = client.get(f"/api/conversations/{conversation_id}/exports/canjson")
    assert retry.status_code == 200
    assert "Original user question" in retry.text
    assert client.get(f"/api/conversations/{conversation_id}/events?event_type=conversation_exported").json()["total"] == 1


def test_failed_event_commit_closes_prepared_file_and_rolls_back(client, monkeypatch):
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    created = []
    original = prepared_export.SpooledTemporaryFile

    def capture(*args, **kwargs):
        stream = original(*args, **kwargs)
        created.append(stream)
        return stream

    def refuse_commit(db):
        if any(isinstance(row, ConversationEvent) and row.event_type == "conversation_exported" for row in db.new):
            raise RuntimeError("Synthetic export commit failure")

    monkeypatch.setattr(prepared_export, "SpooledTemporaryFile", capture)
    event.listen(Session, "before_commit", refuse_commit)
    try:
        response = client.get(f"/api/conversations/{conversation_id}/exports/canjson")
    finally:
        event.remove(Session, "before_commit", refuse_commit)
    assert response.status_code == 500
    assert "Synthetic export commit failure" not in response.text
    assert len(created) == 1 and created[0].closed
    assert client.get(f"/api/conversations/{conversation_id}/events?event_type=conversation_exported").json()["total"] == 0
