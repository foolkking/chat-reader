"""Registration profiles only; all tables and mappings remain in their modules."""
from importlib import import_module

MODULE_EXPORTS = {
    "reader_extension": ("ExtensionDevice", "ExtensionSource"),
    "append_item": ("AppendItem",),
    "context_continuation": ("ContextMemberObject", "ContextBinding", "ContinuationRevision",
                             "ContinuationState", "ContinuationCandidate", "ContinuationValidation", "ContextExportReceipt"),
    "background_job": ("BackgroundJob",),
    "attachment_public_link": ("AttachmentPublicLink",),
    "support_request": ("SupportRequest", "SupportMessage", "UserLimitOverride"),
    "archive_restore": ("ArchiveRestoreAccount", "ArchiveRestoreReceipt"),
    "auth": ("AuthLoginThrottle", "AuthPrincipal", "AuthRateLimit", "AuthSession"),
    "annotation": ("AnnotationSyncReceipt", "ConversationAnnotation", "ConversationNotebook"),
    "task_execution_control": ("TaskExecutionControl",),
    "attachment": ("AssetDerivative", "AssetObject", "AssetObjectLease", "Attachment",
                   "AttachmentUploadItem", "AttachmentUploadSession", "MessageVersionAttachment"),
    "conversation": ("Conversation",),
    "conversation_event": ("ConversationEvent",),
    "conversation_split": ("ConversationSplitReceipt",),
    "content_cleanup": ("ContentCleanupException", "ContentCleanupOccurrence", "ContentCleanupRule",
                        "ContentCleanupRuleAlias", "ContentCleanupRuleGrant", "ContentCleanupRulePublication",
                        "ContentCleanupRulePreference", "ContentCleanupRuleRevision", "ContentCleanupScan",
                        "ContentCleanupScanRule", "ContentCleanupScanTarget"),
    "export_artifact": ("ExportArtifact", "ExportArtifactLease"),
    "heading": ("Heading",),
    "import_record": ("ImportRecord",),
    "import_profile": ("ImportInputGroup", "ImportProfile", "ImportProfileAlias", "ImportProfileGrant",
                       "ImportProfilePreference", "ImportProfilePublication", "ImportProfileRevision", "ImportStructureFamily"),
    "message": ("Message",),
    "message_version": ("MessageVersion",),
    "offline_package_artifact": ("OfflinePackageArtifact",),
    "offline_package_lease": ("OfflinePackageLease",),
    "project": ("Project",),
    "project_conversation": ("ProjectConversation",),
    "reading_position": ("ReadingPosition",),
    "reading_content_baseline": ("ReadingContentBaseline", "ReadingContentBaselineMessage"),
    "recent_item": ("RecentItem",),
    "render_block": ("RenderBlock",),
    "search_document": ("SearchDocument",),
    "share": ("Share", "ShareUnlockSession"),
    "share_snapshot": ("ShareSnapshot",),
    "source_artifact": ("SourceArtifact",),
    "source_message_ref": ("SourceMessageRef",),
    "user_preference": ("UserPreference",),
    "user_feature_entry": ("UserFeatureEntry",),
    "worker_runtime_state": ("WorkerRuntimeState",),
    "user_skill": ("UserSkill", "UserSkillSelection"),
    "skill_bundle": ("SkillFileObject", "SkillBundleRevision", "SkillBundleMember"),
    "user": ("User",),
    "access": ("AccountInvitation", "EmailVerificationGrant", "InstanceAccessSetting", "PasswordResetGrant"),
    "administration": ("AdminAuditLog", "InstanceFeaturePolicy", "SystemBackupRecord", "SystemSkill", "UserDeletionRequest"),
}
PUBLIC_NAMES = frozenset(name for names in MODULE_EXPORTS.values() for name in names)

# Complete FK/relationship closure of the queue, control and liveness models.
# Do not remove relationships or metadata to make a profile smaller.
SUPERVISOR_MODULES = frozenset({
    "attachment", "auth", "background_job", "conversation", "conversation_event",
    "import_profile", "import_record", "message", "message_version", "project",
    "project_conversation", "reading_position", "recent_item", "render_block",
    "source_artifact", "source_message_ref", "task_execution_control", "user", "worker_runtime_state",
})
EXECUTION_MODULES = SUPERVISOR_MODULES | {
    "annotation", "attachment_public_link", "heading", "search_document", "share", "share_snapshot",
}
MAINTENANCE_MODULES = EXECUTION_MODULES | {
    "administration", "export_artifact", "offline_package_artifact", "user_preference",
}


def load_modules(names):
    names = frozenset(names)
    if not names <= MODULE_EXPORTS.keys():
        raise ValueError("Unknown model registration profile")
    exports = {}
    # Preserve the original complete-registration import order.
    for name, symbols in MODULE_EXPORTS.items():
        if name in names:
            module = import_module("app.models." + name)
            exports.update((symbol, getattr(module, symbol)) for symbol in symbols)
    return exports
