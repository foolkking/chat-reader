"use client";
import { continuationWriteError } from "../../lib/continuation-write-recovery";
import type { useContinuationWrite } from "./use-continuation-write";

const button = "min-h-11 rounded-md border border-ui px-3 py-2 text-sm hover:bg-subtle disabled:opacity-50";
export function ContinuationWriteFeedback({ control, zh, onReview }: { control: ReturnType<typeof useContinuationWrite>; zh: boolean; onReview: () => void }) {
  const receipt = control.receipt;
  if (!receipt || receipt.phase === "submitting") return null;
  if (receipt.phase === "confirmed") return control.followupFailed ? <div role="status" className="space-y-2 text-sm text-secondary">
    <p>{zh ? "服务器已确认写入，但后续视图未能更新。无需再次提交。" : "The server confirmed the write, but the view could not update. No need to submit again."}</p>
    <button className={button} disabled={control.checking} onClick={() => void control.refreshConfirmed()}>{zh ? "刷新已保存文件" : "Refresh saved files"}</button>
  </div> : null;
  const files = receipt.intent.kind === "package" ? [receipt.intent.file] : Object.values(receipt.intent.members);
  return <div className="space-y-2 text-sm text-secondary" data-testid="continuation-write-recovery">
    {receipt.phase === "unknown" ? <>
      <p role="status">{zh ? "提交结果待核对。原文件已保留，不会自动重发；关闭面板不会取消已收到的请求。" : "Submission is unconfirmed. Original files are retained and will not be resent automatically. Closing the panel does not cancel a received request."}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={control.checking} onClick={() => void control.check()}>{control.checking ? (zh ? "正在核对…" : "Checking…") : (zh ? "核对结果" : "Check result")}</button>
        {receipt.notFound ? <button className={button} disabled={control.checking} onClick={() => void control.retry()}>{zh ? "按原请求重试" : "Retry the original request"}</button> : null}
      </div>
      {receipt.notFound ? <p className="text-xs">{zh ? "暂未查到相应结果，不代表请求已失败。可稍后再核对；手动重试沿用原版本和请求标识。" : "No matching result was found yet; this does not prove failure. Check again, or explicitly retry with the original version and request identity."}</p> : null}
      {control.checkFailed ? <p role="alert">{zh ? "暂时无法核对。原文件和请求仍保留，请恢复连接后再核对。" : "Could not verify. Original files and request are retained; reconnect and check again."}</p> : null}
    </> : <p role="alert">{continuationWriteError(receipt.error, zh)}</p>}
    {receipt.phase === "rejected" && receipt.intent.origin !== "editor" ? <button className={button} onClick={onReview}>{zh ? "查看当前文件" : "Review current files"}</button> : null}
    <div className="flex flex-wrap gap-2">{files.map(file => <button key={file.name} className={`${button} max-w-full break-all text-left`} onClick={() => {
      const url = URL.createObjectURL(file), link = document.createElement("a");
      link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>{zh ? "下载保留文件：" : "Download retained file: "}{file.name}</button>)}</div>
  </div>;
}
