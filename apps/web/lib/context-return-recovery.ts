import type { BackgroundTaskRead } from "./types";

type Recovery = NonNullable<BackgroundTaskRead["result"]["context_return_recovery"]>;
const adjustmentReasons = new Set([
  "CONTEXT_RETURN_EXPIRED", "CONTEXT_RETURN_UNAVAILABLE", "CONTEXT_RETURN_INVALID",
  "CONTEXT_RETURN_TOO_LARGE", "CONTEXT_MEMBER_INVALID", "CONTEXT_MEMBER_TOO_LARGE",
  "CONTEXT_MEMBERS_REQUIRED", "CONTEXT_MEMBER_UNAVAILABLE", "CONTEXT_BASE_CHANGED", "CONTEXT_NOT_FOUND",
]);

export function contextReturnRecovery(task?: BackgroundTaskRead): Recovery | null {
  if (task?.job_type !== "context_return" || task.status !== "failed") return null;
  const hint = task.result.context_return_recovery;
  if (hint && ["retry", "update_files", "open_list"].includes(hint.action)) return hint;
  // Older servers have no hint. A known deterministic error must still not
  // advertise blind retry; unknown failures retain the existing retry path.
  const reason = task.error_message ?? "CONTEXT_RETURN_FAILED";
  return {
    reason: adjustmentReasons.has(reason) ? reason : "CONTEXT_RETURN_FAILED",
    action: reason === "CONTEXT_NOT_FOUND" ? "open_list" : adjustmentReasons.has(reason) ? "update_files" : "retry",
    conversation_id: null,
  };
}

export function contextReturnFailureMessage(task: BackgroundTaskRead, zh: boolean): string {
  const reason = contextReturnRecovery(task)?.reason;
  switch (reason) {
    case "CONTEXT_RETURN_EXPIRED":
      return zh ? "临时上传已过期或被释放，已保存的接续文件未改变。请重新选择文件。"
        : "The temporary upload expired or was released. Saved continuation files are unchanged. Select the file again.";
    case "CONTEXT_RETURN_UNAVAILABLE":
      return zh ? "临时上传已不可用，已保存的接续文件未改变。请重新选择文件；若仍失败，请管理员检查存储。"
        : "The temporary upload is unavailable. Saved files are unchanged. Select it again; if this persists, ask an administrator to check storage.";
    case "CONTEXT_BASE_CHANGED":
      return zh ? "接续文件已在别处更新。请先核对当前内容，再重新选择文件；不会自动覆盖新版本。"
        : "Continuation files changed elsewhere. Review the current files before selecting yours again; the newer version is not overwritten automatically.";
    case "CONTEXT_RETURN_INVALID":
    case "CONTEXT_MEMBER_INVALID":
    case "CONTEXT_MEMBERS_REQUIRED":
      return zh ? "回传包或接续文件未通过格式校验，已保存的内容未改变。请检查文件后重新选择，也可分别上传 Current 和 Index。"
        : "The package or continuation files failed format validation. Saved content is unchanged. Check and select the files again, or upload Current and Index separately.";
    case "CONTEXT_RETURN_TOO_LARGE":
    case "CONTEXT_MEMBER_TOO_LARGE":
      return zh ? "回传内容超过大小限制，已保存的内容未改变。请缩小内容，或分别上传 Current 和 Index。"
        : "The returned content exceeds the size limit. Saved content is unchanged. Reduce it, or upload Current and Index separately.";
    case "CONTEXT_MEMBER_UNAVAILABLE":
      return zh ? "已保存的接续文件暂时无法读取。请先核对，必要时重新选择 Current 和 Index；持续失败请管理员检查存储。"
        : "Saved continuation files cannot be read. Review them and select Current and Index again if needed; ask an administrator to check persistent storage failures.";
    case "CONTEXT_NOT_FOUND":
      return zh ? "原对话已不可用。请返回列表选择可用对话，不会重试这个更新。"
        : "The original conversation is unavailable. Return to the list and choose an available conversation; this update will not be retried.";
    default:
      return zh ? "接续文件更新未完成，已保存的内容未改变。可重试原任务，或重新选择文件。"
        : "The continuation update did not finish. Saved content is unchanged. Retry the original task or select files again.";
  }
}
