"""Legacy worker error strings must not become public exception disclosures."""

import pytest

from app.services.task_errors import ARCHIVE_FAILURE_MESSAGE, public_task_error


@pytest.mark.parametrize("message", [
    "TASK_FAILED",
    "IMPORT_FAILED",
    "IMPORT_COMMIT_FAILED",
    "UPLOAD_MEMORY_PRESSURE",
    "CONVERSATION_DELETE_FAILED",
    "OFFLINE_ASSET_INTEGRITY",
    "OFFLINE_ASSET_IO",
    "BATCH_EXPORT_SOURCE_UNAVAILABLE",
    "BATCH_EXPORT_LIMIT",
    "BATCH_EXPORT_STORAGE_UNAVAILABLE",
    "ATTACHMENT_EXPORT_ASSET_UNAVAILABLE",
    "ATTACHMENT_EXPORT_INTEGRITY",
    "ATTACHMENT_EXPORT_LIMIT",
    "CONTEXT_EXPORT_SOURCE_CHANGED",
    "CONTEXT_EXPORT_INTEGRITY",
    "CONTEXT_EXPORT_LIMIT",
    "CONTEXT_VALIDATION_RETIRED",
    "CONTEXT_BASE_CHANGED",
    "Conversation changed since it was loaded.",
    "Merge sources grew beyond the accepted limit; submit again.",
    "Import draft has expired.",
    "Import draft line 12 is invalid.",
    "Import draft line 2147483647 exceeds the configured size limit.",
    "Worker stopped before completing 3 times; automatic retries stopped.",
    "Automatic recovery stopped after 3 attempts. The import can be retried manually.",
    "Ownership choices changed. Confirm a new restore from the preview.",
    "An archived email already exists. Review ownership before restoring.",
    "Configuration restore requires a distinct target for each archived account.",
    "The uploaded archive has expired. Upload it again.",
    "System archives can only be restored into an empty instance.",
    ARCHIVE_FAILURE_MESSAGE,
])
def test_known_recovery_errors_remain_available(message):
    assert public_task_error(message) == message


@pytest.mark.parametrize("message", [
    "SELECT private_body FROM synthetic_messages",
    "postgresql://synthetic:private@example.invalid/database",
    "/srv/private/synthetic-message.md",
    r"C:\private\synthetic-message.md",
    "UNREVIEWED_INTERNAL_ERROR_CODE",
    "CONTEXT_EXPORT_PRIVATE_SYNTHETIC_TOKEN",
    "OFFLINE_ASSET_INTEGRITY\nsynthetic-private-details",
    "Import draft line synthetic-private-value is invalid.",
    "Import draft line 12 is invalid. synthetic-private-details",
    "Import draft line １２ is invalid.",
    "Worker stopped before completing 3 times; automatic retries stopped.\nSELECT private",
    "Decoded image exceeds the derivative resource limit.\n/srv/private/source.png",
    "An attachment object is missing. postgresql://synthetic:private@example.invalid/db",
    "Attachment scanner is unavailable.\nsynthetic-private-details",
    "Unsupported attachment scanner provider: synthetic-private-value",
    "Remote attachment scanner is unavailable. synthetic-private-details",
    "TASK_FAILED " + "x" * 2000,
    "",
])
def test_unknown_or_extended_messages_use_only_the_safe_fallback(message):
    assert public_task_error(message) == "TASK_FAILED"
    assert public_task_error(message, fallback="IMPORT_FAILED") == "IMPORT_FAILED"
    assert public_task_error(message, fallback=ARCHIVE_FAILURE_MESSAGE) == ARCHIVE_FAILURE_MESSAGE


def test_no_error_stays_absent():
    assert public_task_error(None) is None
