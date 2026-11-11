"""Safe projections for error text persisted by older worker versions."""

import re


ARCHIVE_FAILURE_MESSAGE = (
    "Archive operation failed. Your current data was preserved; retry the task or upload the archive again."
)

# These are exact public contracts, not a prefix/uppercase-code exemption:
# an arbitrary code-looking value may itself contain private information.
_SAFE_PERSISTED_ERROR_CODES = {
    "IMPORT_RESOURCE_WAIT_EXPIRED", "IMPORT_STORAGE_FULL", "IMPORT_WORKSPACE_EXCEEDED",
    "TASK_FAILED",
    "PLAIN_EXPORT_ACCOUNT_UNAVAILABLE",
    "PLAIN_EXPORT_SOURCE_UNAVAILABLE",
    "PLAIN_EXPORT_LIMIT",
    "PLAIN_EXPORT_STORAGE_UNAVAILABLE",
    "IMPORT_FAILED",
    "IMPORT_COMMIT_FAILED",
    "UPLOAD_MEMORY_PRESSURE",
    "SMALL_IMPORT_BUDGET_EXCEEDED",
    "DELETION_FAILED",
    "CONTEXT_RETURN_FAILED",
    "CONTEXT_RETURN_EXPIRED",
    "CONTEXT_RETURN_UNAVAILABLE",
    "CONTEXT_RETURN_INVALID",
    "CONTEXT_RETURN_TOO_LARGE",
    "CONTEXT_MEMBERS_REQUIRED",
    "CONTEXT_VALIDATION_RETIRED",
    "CONVERSATION_DELETE_FAILED",
    "OFFLINE_ASSET_INTEGRITY",
    "OFFLINE_ASSET_IO",
    "BATCH_EXPORT_ACCOUNT_UNAVAILABLE",
    "BATCH_EXPORT_SOURCE_UNAVAILABLE",
    "BATCH_EXPORT_LIMIT",
    "BATCH_EXPORT_STORAGE_UNAVAILABLE",
    "BATCH_EXPORT_REQUEST_CONFLICT",
    "BATCH_EXPORT_REQUEST_REJECTED",
    "BATCH_EXPORT_UNCONFIRMED",
    "ATTACHMENT_EXPORT_ACCOUNT_UNAVAILABLE",
    "ATTACHMENT_EXPORT_SOURCE_UNAVAILABLE",
    "ATTACHMENT_EXPORT_ASSET_UNAVAILABLE",
    "ATTACHMENT_EXPORT_LIMIT",
    "ATTACHMENT_EXPORT_INTEGRITY",
    "ATTACHMENT_EXPORT_STORAGE_UNAVAILABLE",
    "CONTEXT_EXPORT_ACCOUNT_UNAVAILABLE",
    "CONTEXT_EXPORT_SOURCE_UNAVAILABLE",
    "CONTEXT_EXPORT_ASSET_UNAVAILABLE",
    "CONTEXT_EXPORT_LIMIT",
    "CONTEXT_EXPORT_INTEGRITY",
    "CONTEXT_EXPORT_STORAGE_UNAVAILABLE",
    "CONTEXT_EXPORT_SOURCE_CHANGED",
    "CONTEXT_BASE_CHANGED",
    "CONTEXT_MEMBER_UNAVAILABLE",
    "CONTEXT_MEMBER_TOO_LARGE",
    "CONTEXT_MEMBER_INVALID",
    "CONTEXT_NOT_FOUND",
}

_SAFE_PERSISTED_MESSAGES = {
    ARCHIVE_FAILURE_MESSAGE,
    "Previous worker stopped before completing; task requeued.",
    "The staged import session is no longer available.",
    "There is not enough memory headroom to safely analyze this upload. Reduce the file size or split the batch, then retry.",
    "The server cannot safely commit this import under current memory pressure. Retry when other work finishes, or split the source into smaller conversations.",
    "Conversation not found.",
    "At least one TOC target must be selected.",
    "Unsupported section TOC scope.",
    "Noise scan not found.",
    "Project not found.",
    "Message not found.",
    "Current message version is missing.",
    "Conversation changed since it was loaded.",
    "Source changed while saving. Reload before trying again.",
    "Base version does not match current version.",
    "One or more source attachments are unavailable.",
    "Conversation contains an unavailable attachment object.",
    "Merge sources grew beyond the limit accepted at submission; submit again.",
    "Merge sources grew beyond the accepted limit; submit again.",
    "Import preview has no durable canonical draft.",
    "Import draft is missing.",
    "Import draft has expired.",
    "Import draft conversation count does not match preview.",
    "Import draft message count does not match preview.",
    "Invalid import draft path.",
    "Offline attachment integrity check failed. Retry after repairing the attachment.",
    "Offline attachment could not be packaged. Check attachment availability and server storage, then retry.",
    # Preserve established archive recovery instructions, including the English
    # UI which displays these authored messages directly.
    "The backup account is unavailable.",
    "The restore account is unavailable.",
    "The uploaded archive changed. Upload it again.",
    "The uploaded archive has expired. Upload it again.",
    "The uploaded archive is no longer available. Upload it again.",
    "The uploaded archive is unavailable. Upload it again.",
    "Archive changed since preview. Preview it again.",
    "Archive preview not found.",
    "This request key was already used for different backup options.",
    "This preview has already been confirmed with different restore options.",
    "Wait for a successful archive preview before confirming restore.",
    "Cancel or finish the archive task before removing its upload.",
    "Ownership choices changed. Confirm a new restore from the preview.",
    "Ownership choices changed. Review them before confirming.",
    "Ownership choices changed in another view. Refresh before saving.",
    "An archived email already exists. Review ownership before restoring.",
    "An ownership mapping target is unavailable.",
    "Choose a target account for every unresolved source before restoring.",
    "Configuration restore requires a distinct target for each archived account.",
    "Configure email delivery before restoring a policy that requires email verification.",
    "System archives can only be restored into an empty instance.",
    "System restore requires an instance without customized system Skills.",
    "System restore requires an instance without personal or learned configuration.",
    "Select a personal data archive for additive restore.",
    "Select a non-empty archive.",
    "Archive exceeds the upload size limit.",
    "System archive exceeds the upload size limit.",
    "Personal archive is malformed or incomplete.",
    "System archive is malformed or incomplete.",
    "Archive attachment was rejected by the configured scanner.",
    # Fixed attachment recovery messages only; dynamic scanner/provider text
    # and messages with appended internal details must still use the fallback.
    "Unsupported attachment derivative type.",
    "Attachment object is not available for derivative generation.",
    "Text extraction is not supported for this MIME type.",
    "Image source exceeds the 50 MiB derivative limit.",
    "Image derivatives are not supported for this MIME type.",
    "Decoded image exceeds the derivative resource limit.",
    "Image derivative generation exceeded its deadline.",
    "Image derivative generation failed.",
    "Attachment scanner is unavailable.",
    "Attachment scanner returned an invalid response.",
    "Remote scanner URL is not configured.",
    "Remote attachment scanner is unavailable.",
    "Remote attachment scanner returned an invalid response.",
    "Select 1-500 distinct attachments.",
    "One or more attachments are unavailable or outside this conversation.",
    "Selected attachments exceed the 2 GiB batch limit.",
    "An attachment object is missing.",
    "Invalid export path.",
}
_SAFE_PERSISTED_MESSAGES.update(
    f"Backup exceeds the configured restore limit ({setting}). "
    "Ask an administrator to review archive capacity before retrying."
    for setting in (
        "BUNDLE_MAX_COMPRESSED_BYTES", "BUNDLE_MAX_OBJECT_BYTES", "BUNDLE_MAX_OBJECTS",
        "BUNDLE_MAX_ENTRIES", "CANJSON_MAX_LINE_BYTES", "BUNDLE_MAX_EXPANDED_BYTES",
    )
)

_SAFE_NUMERIC_MESSAGES = (
    re.compile(r"Import draft line [1-9][0-9]{0,9} (?:is invalid|exceeds the configured size limit)\."),
    re.compile(r"Worker stopped before completing [1-9][0-9]{0,2} times; automatic retries stopped\."),
    re.compile(r"Automatic recovery stopped after [1-9][0-9]{0,2} attempts\. The import can be retried manually\."),
)

_SAFE_IMPORT_FAILURE_CODES = {
    "ZIP_METADATA_LIMIT", "ZIP_SOURCE_CHANGED", "SOURCE_CHANGED", "SOURCE_PATH_INVALID",
    "IMPORT_RESOURCE_WAIT_EXPIRED",
    "IMPORT_MESSAGE_TOO_LARGE", "IMPORT_WORKSPACE_EXCEEDED", "IMPORT_STORAGE_FULL", "ZIP_MANIFEST_INVALID",
    "UPLOAD_MEMORY_PRESSURE", "SMALL_IMPORT_BUDGET_EXCEEDED",
    "UPLOAD_QUEUE_FULL", "UPLOAD_QUEUE_TIMEOUT", "ZIP_INVALID", "ZIP_ENTRY_LIMIT",
    "ZIP_MEMBER_TOO_LARGE", "ZIP_EXPANDED_LIMIT", "ZIP_COMPRESSION_UNSAFE",
    "ZIP_PATH_UNSAFE", "ZIP_PATH_DUPLICATE", "ZIP_CRC_INVALID", "ZIP_MARKDOWN_REQUIRED",
    "MARKDOWN_ENCODING_INVALID", "MARKDOWN_EMPTY", "MARKDOWN_FENCE_UNCLOSED",
    "NO_MESSAGE_STRUCTURE", "DOCUMENT_NOT_TRANSCRIPT", "IMPORT_PLAN_INVALID",
    "MANIFEST_ASSET_MISSING", "MANIFEST_ASSET_PATH_INVALID", "MARKDOWN_RESOURCE_MISSING",
    "ZIP_PATH_DEPTH_LIMIT", "ZIP_MEMBER_UNSUPPORTED", "SOURCE_MISSING",
}
_SAFE_IMPORT_FAILURE_STAGES = {
    "admission", "archive", "analysis", "normalization", "mapping", "validation",
    "grouping", "file", "commit",
}
_SAFE_ARCHIVE_REASONS = frozenset({
    "empty", "nul", "absolute", "parent_segment", "backslash", "local_filesystem",
    "noncanonical", "duplicate", "encrypted", "special_file", "outside_archive",
    "invalid_url", "excessive_encoding",
})


def public_import_failure_details(value) -> dict[str, object]:
    """Locations are bounded ordinals, never a raw source/server path or URL."""
    if not isinstance(value, dict):
        return {}
    details = {}
    if isinstance(value.get("reason"), str) and value["reason"] in _SAFE_ARCHIVE_REASONS:
        details["reason"] = value["reason"]
    index = value.get("entry_index")
    if type(index) is int and 1 <= index <= 1_000_000:
        details["entry_index"] = index
    return details


def adaptive_import_failure(code: str | None, stage: str | None, retryable: bool, *, details=None) -> dict[str, object]:
    """Project internal task failures onto stable, non-sensitive UI metadata."""
    safe_code = code if isinstance(code, str) and code in _SAFE_IMPORT_FAILURE_CODES else "TASK_FAILED"
    safe_stage = stage if isinstance(stage, str) and stage in _SAFE_IMPORT_FAILURE_STAGES else "analysis"
    result = {
        "code": safe_code,
        "stage": safe_stage,
        "retryable": bool(retryable and safe_code != "TASK_FAILED"),
    }
    if safe_code in {"ZIP_PATH_UNSAFE", "ZIP_PATH_DUPLICATE", "ZIP_MEMBER_UNSUPPORTED", "MANIFEST_ASSET_PATH_INVALID"}:
        safe_details = public_import_failure_details(details)
        if safe_details:
            result["details"] = safe_details
    return result


def import_failure_from_exception(exc: Exception, *, stage: str) -> dict[str, object]:
    """Retain a safe reason across draft/persistence wrappers, never their text."""
    current = exc
    seen: set[int] = set()
    for _ in range(12):
        if id(current) in seen:
            break
        seen.add(id(current))
        import errno
        if isinstance(current, OSError) and current.errno in {errno.ENOSPC, errno.EDQUOT}:
            return adaptive_import_failure("IMPORT_STORAGE_FULL", stage, False)
        code = getattr(current, "code", None)
        if isinstance(code, str) and code in _SAFE_IMPORT_FAILURE_CODES:
            return adaptive_import_failure(
                code,
                getattr(current, "stage", None) or (
                    "commit" if stage == "commit" else getattr(current, "layer", None) or "admission"
                ),
                code in {"UPLOAD_MEMORY_PRESSURE", "SMALL_IMPORT_BUDGET_EXCEEDED", "UPLOAD_QUEUE_FULL", "UPLOAD_QUEUE_TIMEOUT"},
                details=getattr(current, "details", None),
            )
        cause = current.__cause__ or current.__context__
        if not isinstance(cause, Exception):
            break
        current = cause
    return adaptive_import_failure("TASK_FAILED", stage, False)


def public_import_failure(value, *, error_message: str | None = None, stage="analysis") -> dict | None:
    if isinstance(value, dict) and isinstance(value.get("code"), str):
        return adaptive_import_failure(
            value["code"], value.get("stage"), value.get("retryable") is True,
            details=value.get("details"),
        )
    # Legacy tasks retained this authored message, but no machine-readable code.
    safe_message = public_task_error(error_message)
    if safe_message in {
        "UPLOAD_MEMORY_PRESSURE",
        "There is not enough memory headroom to safely analyze this upload. Reduce the file size or split the batch, then retry.",
        "The server cannot safely commit this import under current memory pressure. Retry when other work finishes, or split the source into smaller conversations.",
    }:
        return adaptive_import_failure("UPLOAD_MEMORY_PRESSURE", stage, True)
    return None


def public_task_error(value: str | None, *, fallback: str = "TASK_FAILED") -> str | None:
    """Return only known public codes/messages; never echo legacy exception text."""
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 2000:
        return fallback
    normalized = value.strip()
    if normalized in _SAFE_PERSISTED_ERROR_CODES or normalized in _SAFE_PERSISTED_MESSAGES:
        return normalized
    if any(pattern.fullmatch(normalized) for pattern in _SAFE_NUMERIC_MESSAGES):
        return normalized
    return fallback
