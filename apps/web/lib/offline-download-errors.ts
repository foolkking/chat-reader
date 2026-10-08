/** Persist only recognized failure categories, never raw server exception text. */
export function offlineGenerationFailureCode(message: string | null | undefined): string {
  if (message === "OFFLINE_ASSET_INTEGRITY" || message === "Offline attachment integrity check failed. Retry after repairing the attachment.") return "OFFLINE_ASSET_INTEGRITY";
  if (message === "OFFLINE_ASSET_IO" || message === "Offline attachment could not be packaged. Check attachment availability and server storage, then retry.") return "OFFLINE_ASSET_IO";
  return "GENERATION";
}

export function offlineFailureNeedsRebuild(code: string | null): boolean {
  return ["GONE", "GENERATION", "MALFORMED", "OFFLINE_ASSET_INTEGRITY", "OFFLINE_ASSET_IO"].includes(code ?? "");
}

export function offlineDownloadFailureMessage(code: string | null, zh: boolean, hasExistingCopies: boolean): string {
  const retained = hasExistingCopies ? (zh ? "现有副本已保留。" : " Existing copies are retained.") : "";
  if (code === "QUOTA") return (zh ? "浏览器空间不足，请释放空间后重试。" : "Browser storage is full. Free space and retry.") + retained;
  if (code === "MALFORMED") return (zh ? "离线包不完整或已损坏，重试将重新生成。" : "The offline package is incomplete or damaged. Retry to rebuild.") + retained;
  if (code === "STORAGE_WRITE") return (zh ? "浏览器未能完成写入，请检查本机空间后重试。" : "The browser could not finish writing. Check local storage and retry.") + retained;
  if (code === "GONE") return (zh ? "服务器包已被替换，重试将重新生成。" : "The server package was replaced. Retry to rebuild.") + retained;
  if (code === "OFFLINE_ASSET_INTEGRITY") return (zh ? "附件内容已损坏，请修复附件或联系管理员后重试。" : "An attachment is damaged. Repair it or contact your administrator before retrying.") + retained;
  if (code === "OFFLINE_ASSET_IO") return (zh ? "服务器无法打包附件，请联系管理员检查附件和服务器存储后重试。" : "The server could not package an attachment. Ask your administrator to check the attachment and server storage before retrying.") + retained;
  if (code === "GENERATION") return (zh ? "离线包生成失败，重试将重新生成。" : "Offline package generation failed. Retry to rebuild.") + retained;
  return (zh ? "离线下载未完成，请检查连接后重试。" : "The offline download did not finish. Check the connection and retry.") + retained;
}
