import sys
from threading import RLock

from app.models._loading import (
    EXECUTION_MODULES, MAINTENANCE_MODULES, MODULE_EXPORTS, PUBLIC_NAMES,
    SUPERVISOR_MODULES, load_modules,
)

_registration_lock = RLock()
_spec = getattr(sys.modules.get("__main__"), "__spec__", None)
_role = getattr(_spec, "name", None)
_complete = _role not in {"app.workers.import_worker", "app.workers.execution_child"}
globals().update(load_modules(
    MODULE_EXPORTS if _complete else
    SUPERVISOR_MODULES if _role == "app.workers.import_worker" else EXECUTION_MODULES
))


def _register_all_models():
    """Default/API/Alembic registration, also used before non-ZIP execution."""
    global _complete
    with _registration_lock:
        if not _complete:
            globals().update(load_modules(MODULE_EXPORTS))
            _complete = True


def _register_maintenance_models():
    with _registration_lock:
        globals().update(load_modules(MAINTENANCE_MODULES))


def __getattr__(name):
    # Explicit legacy package exports always retain their genuine mapped class.
    if name in PUBLIC_NAMES:
        _register_all_models()
        return globals()[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "ContextMemberObject", "ContextBinding", "ContinuationRevision", "ContinuationState",
    "ContinuationCandidate", "ContinuationValidation", "ContextExportReceipt",
    "SkillFileObject",
    "SkillBundleRevision",
    "SkillBundleMember",
    "BackgroundJob",
    "AttachmentPublicLink",
    "AuthLoginThrottle",
    "AuthPrincipal",
    "AuthRateLimit",
    "AuthSession",
    "AnnotationSyncReceipt",
    "AssetDerivative",
    "AssetObject",
    "AssetObjectLease",
    "Attachment",
    "AttachmentUploadItem",
    "AttachmentUploadSession",
    "Conversation",
    "ConversationAnnotation",
    "ConversationNotebook",
    "ConversationEvent",
    "ConversationSplitReceipt",
    "ContentCleanupOccurrence",
    "ContentCleanupRule",
    "ContentCleanupRuleRevision",
    "ContentCleanupScan",
    "ContentCleanupScanRule",
    "ContentCleanupScanTarget",
    "ExportArtifact",
    "ExportArtifactLease",
    "Heading",
    "ImportRecord",
    "ImportInputGroup",
    "ImportProfile",
    "ImportProfileRevision",
    "ImportStructureFamily",
    "Message",
    "MessageVersion",
    "MessageVersionAttachment",
    "OfflinePackageArtifact",
    "OfflinePackageLease",
    "Project",
    "ProjectConversation",
    "ReadingPosition",
    "ReadingContentBaseline",
    "ReadingContentBaselineMessage",
    "RecentItem",
    "RenderBlock",
    "SearchDocument",
    "Share",
    "ShareUnlockSession",
    "ShareSnapshot",
    "SourceArtifact",
    "SourceMessageRef",
    "UserPreference",
    "UserFeatureEntry",
    "WorkerRuntimeState",
    "TaskExecutionControl",
    "UserSkill",
    "UserSkillSelection",
    "User",
    "AccountInvitation",
    "InstanceAccessSetting",
    "PasswordResetGrant",
    "AdminAuditLog",
    "InstanceFeaturePolicy",
    "SystemBackupRecord",
    "SystemSkill",
    "UserDeletionRequest",
]
