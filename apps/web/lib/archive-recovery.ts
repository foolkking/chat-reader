import type { BackgroundTaskRead } from "./types";

export type ArchiveUploadRecovery = "choose" | "upload";

/** Only known upload failures change the action; unknown/server failures keep retry. */
export function archiveUploadRecovery(task?: BackgroundTaskRead): ArchiveUploadRecovery | null {
  if (!task || !["personal_archive_preflight", "system_archive_preflight"].includes(task.job_type)
      || !["failed", "committed", "cancelled"].includes(task.status)) return null;
  const expires = Date.parse(String(task.result.expires_at));
  if (task.result.artifact_available === false || Number.isFinite(expires) && expires <= Date.now()) return "upload";
  if (task.status === "cancelled") return "upload";
  if (task.status !== "failed") return null;
  const message = task.error_message ?? "";
  if (/^The uploaded archive (?:has expired|is no longer available|is unavailable|changed)\./.test(message)
      || message === "Archive changed since preview. Preview it again.") return "upload";
  // These prefixes belong to archive input validation, not export creation,
  // storage errors, account ownership review or server configuration failures.
  if (/^(?:Personal archive|System archive|Archive) (?:is malformed|contains |is missing |manifest |canonical entry |attachment (?:checksum|size)|exceeds |does not cover )/.test(message)
      || message === "Select a personal data archive for additive restore."
      || /^Unsupported system archive (?:format|configuration version)\.$/.test(message)
      || message === "A personal archive cannot mix account ownership.") return "choose";
  return null;
}

export function archiveUploadRecoveryLabel(action: ArchiveUploadRecovery, zh: boolean) {
  return action === "upload" ? (zh ? "重新上传归档" : "Upload archive again") : (zh ? "选择其他归档" : "Choose another archive");
}
