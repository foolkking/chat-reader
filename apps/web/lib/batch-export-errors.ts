export function batchExportError(code: string | undefined, zh: boolean): string {
  switch (code) {
    case "BATCH_EXPORT_SOURCE_UNAVAILABLE": return zh ? "部分对话已删除或不可访问，请刷新列表后重新选择。" : "Some conversations are unavailable. Refresh the list and select again.";
    case "BATCH_EXPORT_ACCOUNT_UNAVAILABLE": return zh ? "账户不可用，请重新登录。" : "Your account is unavailable. Sign in again.";
    case "BATCH_EXPORT_LIMIT": return zh ? "导出超过大小限制，请减少所选对话后重试。" : "This export exceeds the size limit. Select fewer conversations and retry.";
    case "BATCH_EXPORT_STORAGE_UNAVAILABLE": return zh ? "导出空间暂时不可用，请稍后重试。" : "Export storage is temporarily unavailable. Retry later.";
    default: return zh ? "未能完成导出，可在任务中心查看并重试。" : "Export could not finish. Check Tasks and retry.";
  }
}
