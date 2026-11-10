/** Persist only recognized failure categories, never raw server exception text. */
export function offlineGenerationFailureCode(message: string | null | undefined): string {
  if (message === "OFFLINE_CONTEXT_UNAVAILABLE" || message === "OFFLINE_CONTEXT_INTEGRITY") return message;
  if (message === "OFFLINE_ASSET_INTEGRITY" || message === "Offline attachment integrity check failed. Retry after repairing the attachment.") return "OFFLINE_ASSET_INTEGRITY";
  if (message === "OFFLINE_ASSET_IO" || message === "Offline attachment could not be packaged. Check attachment availability and server storage, then retry.") return "OFFLINE_ASSET_IO";
  return "GENERATION";
}

export function offlineFailureNeedsRebuild(code: string | null): boolean {
  return ["GONE", "EXPIRED_ARTIFACT", "GENERATION", "MALFORMED", "PARTIAL", "OFFLINE_ASSET_INTEGRITY", "OFFLINE_ASSET_IO", "OFFLINE_CONTEXT_UNAVAILABLE", "OFFLINE_CONTEXT_INTEGRITY"].includes(code ?? "");
}

export function offlineFailurePausesQueue(code: string): boolean {
  return ["NETWORK", "DOWNLOAD", "AUTH", "QUOTA", "STORAGE_WRITE", "OFFLINE_ASSET_IO", "SERVER_BUSY"].includes(code);
}

/** Only independent, known child failures may advance to the next conversation.
 * Authorization/scope changes, unknown admissions and local I/O never do. */
export function offlineFailureIsIndependent(code: string): boolean {
  return ["CAPACITY", "GENERATION", "MALFORMED", "GONE", "EXPIRED_ARTIFACT", "OFFLINE_ASSET_INTEGRITY",
    "OFFLINE_CONTEXT_UNAVAILABLE", "OFFLINE_CONTEXT_INTEGRITY"].includes(code);
}

export function offlineFailureCanRetry(code: string | null): boolean {
  return code !== "CAPACITY" && code !== "UNAVAILABLE_TARGET";
}

export function offlineDownloadFailureMessage(code: string | null, zh: boolean, hasExistingCopies: boolean): string {
  const retained = hasExistingCopies ? (zh ? "现有副本已保留。" : " Existing copies are retained.") : "";
  if (code === "PARTIAL") return (zh ? "部分对话未完成。可查看逐项原因并只重试未完成项；失败项没有计入成功。" : "Some conversations did not finish. Review individual reasons and retry only unfinished items; failed items are not counted as completed.") + retained;
  if (code === "AUTH") return (zh ? "账户授权需要重新确认，下载队列已暂停。确认账户后可继续未完成项。" : "Account authorization needs confirmation. Downloads are paused; confirm the account to continue unfinished items.") + retained;
  if (code === "SERVER_BUSY") return (zh ? "服务器暂时繁忙，下载队列已暂停。稍后可继续，不会重复已完成项。" : "The server is busy. Downloads are paused; continue later without repeating completed items.") + retained;
  if (code === "OFFLINE_CONTEXT_UNAVAILABLE") return (zh ? "对话的 Current / Index 文件缺失或无法读取。请先联系管理员恢复文件，再重新生成离线包。" : "Saved Current / Index files are missing or unreadable. Ask your administrator to restore them before rebuilding.") + retained;
  if (code === "OFFLINE_CONTEXT_INTEGRITY") return (zh ? "对话的 Current / Index 文件校验失败。请先修复文件，再重新生成离线包。" : "Saved Current / Index files failed verification. Repair them before rebuilding.") + retained;
  if (code === "QUOTA") return (zh ? "浏览器空间不足，请释放空间后重试。" : "Browser storage is full. Free space and retry.") + retained;
  if (code === "CAPACITY") return (zh ? "这个对话超过本机浏览器的安全导入上限。可以减少下载附件后重试；若仅正文仍超限，需要拆分对话，重复生成相同包无效。" : "This conversation exceeds the browser's safe import limit. Retry with fewer attachments. If text alone still exceeds the limit, split the conversation; rebuilding the same package will not help.") + retained;
  if (code === "MALFORMED") return (zh ? "离线包不完整或已损坏，重试将重新生成。" : "The offline package is incomplete or damaged. Retry to rebuild.") + retained;
  if (code === "STORAGE_WRITE") return (zh ? "浏览器未能完成写入，请检查本机空间后重试。" : "The browser could not finish writing. Check local storage and retry.") + retained;
  if (code === "GONE" || code === "EXPIRED_ARTIFACT") return (zh ? "离线下载凭据已过期，重试将只重新生成当前未完成的对话；已完成副本会保留。" : "The offline download artifact expired. Retry rebuilds only unfinished conversations; completed copies are retained.") + retained;
  if (code === "UNAVAILABLE_TARGET") return (zh ? "下载范围中的部分对话已删除或当前不可访问。请先重新核对范围；不会自动跳过并报成功。" : "Some conversations in this download scope were deleted or are no longer available. Review the scope before continuing; unavailable items will not be silently skipped.") + retained;
  if (code === "OFFLINE_ASSET_INTEGRITY") return (zh ? "附件内容已损坏，请修复附件或联系管理员后重试。" : "An attachment is damaged. Repair it or contact your administrator before retrying.") + retained;
  if (code === "OFFLINE_ASSET_IO") return (zh ? "服务器无法打包附件，请联系管理员检查附件和服务器存储后重试。" : "The server could not package an attachment. Ask your administrator to check the attachment and server storage before retrying.") + retained;
  if (code === "GENERATION") return (zh ? "离线包生成失败，重试将重新生成。" : "Offline package generation failed. Retry to rebuild.") + retained;
  return (zh ? "离线下载未完成，请检查连接后重试。" : "The offline download did not finish. Check the connection and retry.") + retained;
}
