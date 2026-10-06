export function batchExportError(code: string | undefined, zh: boolean): string {
  switch (code) {
    case "BATCH_EXPORT_SOURCE_UNAVAILABLE": return zh ? "部分对话已删除或不可访问，请刷新列表后重新选择。" : "Some conversations are unavailable. Refresh the list and select again.";
    case "BATCH_EXPORT_ACCOUNT_UNAVAILABLE": return zh ? "账户不可用，请重新登录。" : "Your account is unavailable. Sign in again.";
    case "BATCH_EXPORT_LIMIT": return zh ? "导出超过大小限制，请减少所选对话后重试。" : "This export exceeds the size limit. Select fewer conversations and retry.";
    case "BATCH_EXPORT_STORAGE_UNAVAILABLE": return zh ? "导出空间暂时不可用，请稍后重试。" : "Export storage is temporarily unavailable. Retry later.";
    case "ATTACHMENT_EXPORT_SOURCE_UNAVAILABLE": return zh ? "对话已删除或不可访问，请返回列表确认。" : "This conversation is no longer available. Check your conversation list.";
    case "ATTACHMENT_EXPORT_ACCOUNT_UNAVAILABLE": return zh ? "账户不可用，请重新登录。" : "Your account is unavailable. Sign in again.";
    case "ATTACHMENT_EXPORT_ASSET_UNAVAILABLE": return zh ? "附件已不可用，请检查附件后重新导出。" : "An attachment is no longer available. Check attachments and export again.";
    case "ATTACHMENT_EXPORT_INTEGRITY": return zh ? "附件内容校验失败，未生成下载包。请重新上传该附件或联系管理员。" : "Attachment integrity check failed; no download was created. Re-upload the attachment or contact your administrator.";
    case "ATTACHMENT_EXPORT_LIMIT": return zh ? "附件导出超过大小或数量限制，可先导出不含附件的内容。" : "This attachment export exceeds size or count limits. Export without attachments first.";
    case "ATTACHMENT_EXPORT_STORAGE_UNAVAILABLE": return zh ? "导出存储暂时不可用，请稍后重试。" : "Export storage is temporarily unavailable. Retry later.";
    default: return zh ? "未能完成导出，可在任务中心查看并重试。" : "Export could not finish. Check Tasks and retry.";
  }
}
