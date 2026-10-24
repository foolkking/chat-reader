"""Only authored business errors may become public worker failure details."""
import pytest
from sqlalchemy.exc import StatementError

from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.assets.derivatives import AssetDerivativeError
from app.services.assets.scanner import AssetScanError
from app.services.background_jobs import _safe_error
from app.services.continuation_candidates import ContinuationError
from app.services.editing.message_edit_service import MessageEditError
from app.services.exporting.attachment_download import AttachmentDownloadError
from app.services.exporting.context_package import ContextPackageError
from app.services.exporting.cr_archive import CrArchiveError
from app.services.exporting.export_service import ExportError
from app.services.offline_packages import OfflinePackageError
from app.services.uploads import UploadLimitError


@pytest.mark.parametrize("error", [
    MessageEditError("Merge sources grew beyond the accepted limit; submit again.", 422),
    OfflinePackageError("OFFLINE_ASSET_INTEGRITY"),
    ContextPackageError("CONTEXT_EXPORT_LIMIT"),
    CrArchiveError("Conversation contains an unavailable attachment object."),
    ExportError("BATCH_EXPORT_STORAGE_UNAVAILABLE", 503),
    AttachmentDownloadError("An attachment object is missing."),
    AssetDerivativeError("Decoded image exceeds the derivative resource limit."),
    AssetScanError("Attachment scanner is unavailable."),
    AdaptiveImportError("SESSION_STATE_INVALID", "The session changed.", layer="session"),
    UploadLimitError("UPLOAD_MEMORY_PRESSURE", "Insufficient memory headroom.", status_code=429),
    ContinuationError("CONTEXT_BASE_CHANGED", 409),
    ValueError("CONTEXT_RETURN_FAILED"),
    ValueError("CONTEXT_VALIDATION_RETIRED"),
    ValueError("The staged import session is no longer available."),
    ValueError("Conversation not found."),
    ValueError("At least one TOC target must be selected."),
    ValueError("Unsupported section TOC scope."),
    ValueError("Noise scan not found."),
])
def test_authored_business_errors_keep_their_existing_public_details(error):
    assert _safe_error(error) == str(error)


@pytest.mark.parametrize("error", [
    RuntimeError("private synthetic source /srv/private-source.md"),
    ValueError("private synthetic source /srv/private-source.md"),
    OSError("private synthetic source /srv/private-source.md"),
    KeyError("private synthetic message content"),
    StatementError(
        "private synthetic SQL failure",
        "SELECT private_message FROM private_table WHERE id = :private_id",
        {"private_id": "synthetic-private-value"},
        RuntimeError("postgresql://synthetic:private@example.invalid/private"),
    ),
    ValueError("UNREVIEWED_INTERNAL_ERROR_CODE"),
])
def test_unexpected_worker_errors_never_publish_their_exception_text(error):
    assert _safe_error(error) == "TASK_FAILED"


def test_reporting_an_unexpected_error_does_not_need_its_string_representation():
    class UnprintableError(RuntimeError):
        def __str__(self):
            raise AssertionError("Unexpected exceptions must not be formatted for public output.")

    assert _safe_error(UnprintableError()) == "TASK_FAILED"


def test_authored_worker_error_details_remain_bounded():
    assert len(_safe_error(MessageEditError("x" * 3000))) == 2000
