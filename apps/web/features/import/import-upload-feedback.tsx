"use client";
import { importErrorMessage, useImportCopy } from "./import-workspace-copy";
import type { useImportUpload } from "./use-import-upload";

const button = "btn-secondary min-h-11 px-3 text-sm disabled:opacity-50";
export function ImportUploadFeedback({ control, zh, openTasks, leavePending, endCheck }: {
  control: ReturnType<typeof useImportUpload>; zh: boolean; openTasks: () => void; leavePending: () => void; endCheck: () => void;
}) {
  const tr = useImportCopy();
  const receipt = control.receipt;
  if (!receipt) return null;
  if (receipt.phase === "uploading") {
    const sent = receipt.progress?.stage === "confirming", percent = receipt.progress?.percent;
    return <div className="space-y-2 text-sm" data-testid="import-upload-status">
      <p role="status">{sent ? (zh ? "文件已发送，等待服务器确认…" : "Files sent. Waiting for the server to confirm…")
        : (zh ? "正在上传文件" : "Uploading files") + (percent == null ? "…" : ` · ${percent}%`)}</p>
      {!sent ? <progress className="h-1 w-full accent-[var(--accent)]" max={100} value={percent ?? undefined}
        aria-label={zh ? "上传文件" : "Uploading files"} /> : null}
      <button type="button" className={button} onClick={() => receipt.cancel?.()}>{zh ? "停止上传并核对" : "Stop upload and check"}</button>
      <p className="text-xs text-secondary">{zh ? "关闭面板仍会继续上传；停止仅中断本机传输，服务器是否已收到需再核对。" : "Closing this panel keeps uploading. Stop only interrupts local transfer; server receipt still needs checking."}</p>
    </div>;
  }
  if (receipt.phase === "rejected") return <p role="alert" className="text-sm text-[var(--danger)]">
    {importErrorMessage(receipt.error, tr, "mutation")}
  </p>;
  return <div className="space-y-2 text-sm text-secondary" data-testid="import-upload-recovery">
    <p role="status">{receipt.unavailable
      ? (zh ? "已确认接收过文件，但原导入当前不可用。请查看后台任务，或结束本页核对。" : "The files were received, but the original import is no longer available. Check Tasks, or end this page's check.")
      : receipt.phase === "confirmed"
      ? receipt.checkFailed
        ? (zh ? "服务器已接收文件，但原导入页面尚未读到。无需再次上传。" : "The server received the files, but the original import could not be read. No upload is needed.")
        : (zh ? "服务器已接收文件，正在打开原导入。无需再次上传。" : "The server received the files. Opening the original import; no upload is needed.")
      : (zh ? "上传结果待核对，所选文件仍保留。不会自动重新上传。" : "Upload receipt is unconfirmed. Selected files are retained and will not be uploaded again automatically.")}</p>
    {receipt.checkFailed ? <p role="alert">{zh ? "暂时无法读取结果，请恢复连接后再次核对；没有重新提交。" : "Could not read the result. Reconnect and check again; nothing was resubmitted."}</p> : null}
    <div className="flex flex-wrap gap-2">
      {!receipt.unavailable ? <button type="button" className={button} disabled={receipt.checking} onClick={() => void control.check()}>
        {receipt.checking ? (zh ? "正在核对…" : "Checking…") : receipt.phase === "confirmed"
          ? (zh ? "打开原导入" : "Open original import") : (zh ? "核对上传结果" : "Check upload receipt")}
      </button> : null}
      {receipt.phase === "unknown" && receipt.notFound ? <button type="button" className={button}
        disabled={receipt.checking} onClick={() => void control.retry()}>{zh ? "重试原上传" : "Retry original upload"}</button> : null}
      <button type="button" className={button} onClick={openTasks}>{zh ? "查看后台任务" : "View background tasks"}</button>
      {control.canDetach ? <button type="button" className="min-h-11 px-2 text-sm underline underline-offset-4"
        onClick={leavePending}>{zh ? "保留待核对，处理其他文件" : "Keep pending; work on other files"}</button> : null}
    </div>
    {receipt.notFound ? <p className="text-xs">{zh ? "暂未查到回执，不代表已经失败。可稍后核对；手动重试保持原文件、顺序和请求标识。" : "No receipt found yet; this does not prove failure. Check later, or explicitly retry with the same files, order and request identity."}</p> : null}
    {receipt.phase === "unknown" && control.retained.length >= 3 ? <p className="text-xs">{zh
      ? "本页已保留三批待核对上传。请先核对，或明确结束不再需要的本页核对；仍可关闭面板。"
      : "Three pending uploads are retained. Check them or explicitly end a page check you no longer need; you can still close this panel."}</p> : null}
    {!receipt.checking ? <details className="text-xs" data-testid="import-upload-end-check">
      <summary className="min-h-11 cursor-pointer content-center underline underline-offset-4">{zh ? "结束本页核对" : "End this page's check"}</summary>
      <p className="mb-2">{zh
        ? "只移除本页待核对记录和文件选择，不会停止后台任务或删除服务器文件。请先查看任务，避免把同一批文件重复导入。"
        : "Only removes this page's pending record and file selection. It does not stop background work or delete server files. Check Tasks first to avoid importing the same files twice."}</p>
      <button type="button" className={button} onClick={endCheck}>{zh ? "确认结束本页核对" : "Confirm ending this page's check"}</button>
    </details> : null}
  </div>;
}
