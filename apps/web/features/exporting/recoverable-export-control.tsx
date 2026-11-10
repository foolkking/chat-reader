"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiRequestError, getTask, readConversationExportRequest, submitConversationExport, type ConversationExportRequest } from "../../lib/api";
import { authenticationGeneration, assertOfflineAccess, captureOfflineAccess, AUTH_GENERATION_CHANGED_EVENT } from "../../lib/offline-access";
import { batchExportError, exportNeedsAdjustment } from "../../lib/batch-export-errors";
import type { BackgroundTaskRead } from "../../lib/types";
import { DirectExportDownload } from "./direct-export-download";
import { ExportArtifactDelivery } from "./export-artifact-delivery";

type Receipt = {
  key: string;
  phase: "submitting" | "unknown" | "accepted" | "rejected";
  job?: BackgroundTaskRead;
  error?: string;
  notFound?: boolean;
};

// Intent: retain this reader's exact export choices and make recovery local to
// the action. Existing paper/graphite, flat feedback, 4px spacing, app type,
// quiet borders and 44px targets; no new status card or permanent success row.
export function RecoverableExportControl({ conversationId, identity, request, zh, scope, disabled,
  plainHref, initialJobId, onAccepted, renderDelivery, deliveryDisabled = false,
}: {
  conversationId: string; identity: string; request: ConversationExportRequest; zh: boolean; scope: string;
  disabled?: boolean; plainHref?: string; initialJobId?: string | null;
  deliveryDisabled?: boolean;
  onAccepted: (task: BackgroundTaskRead) => void;
  renderDelivery?: (control: ReactNode) => ReactNode;
}) {
  const client = useQueryClient();
  const [generation, setGeneration] = useState(authenticationGeneration);
  const openedGeneration = useRef(generation);
  const retired = openedGeneration.current !== generation;
  useEffect(() => {
    const changed = () => setGeneration(authenticationGeneration());
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, changed);
    return () => window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, changed);
  }, []);
  const cacheKey = ["export-request", generation, conversationId, identity];
  const receipt = useQuery<Receipt | null>({
    queryKey: cacheKey, queryFn: () => null, enabled: false, staleTime: Infinity, gcTime: Infinity,
  }).data;
  const current = () => client.getQueryData<Receipt>(cacheKey);
  const jobId = receipt ? receipt.job?.job_id : initialJobId;
  const task = useQuery({
    queryKey: ["task", jobId],
    queryFn: ({ signal }) => getTask(jobId!, signal),
    enabled: Boolean(jobId) && !retired,
    refetchInterval: query => ["committed", "failed", "cancelled"].includes(query.state.data?.status ?? "") ? false : 1500,
  });
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const lock = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const acceptedCallback = useRef(onAccepted);
  acceptedCallback.current = onAccepted;
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (receipt?.job && !retired) acceptedCallback.current(receipt.job);
  }, [receipt?.job, retired]);
  const focusRecovery = (hadFocus: boolean) => {
    if (hadFocus && alive.current) requestAnimationFrame(() => {
      if (document.activeElement === document.body) root.current?.focus({ preventScroll: true });
    });
  };
  function accept(job: BackgroundTaskRead, key: string) {
    client.setQueryData(["task", job.job_id], job);
    client.setQueryData<Receipt>(cacheKey, { key, phase: "accepted", job });
    void client.invalidateQueries({ queryKey: ["tasks"] });
    void client.invalidateQueries({ queryKey: ["active-tasks"] });
  }
  async function submit(reuse = false) {
    const prior = current();
    if (lock.current || disabled || retired || prior?.phase === "submitting" || (prior?.phase === "unknown" && (!reuse || !prior.notFound))) return;
    lock.current = true;
    const focused = Boolean(root.current?.contains(document.activeElement));
    const key = reuse && prior ? prior.key : `export-${crypto.randomUUID()}`;
    try {
      const access = captureOfflineAccess();
      client.setQueryData<Receipt>(cacheKey, { key, phase: "submitting" });
      const job = await submitConversationExport(conversationId, request, key);
      assertOfflineAccess(access);
      accept(job, key);
    } catch (error) {
      if (generation === authenticationGeneration()) {
        const rejected = error instanceof ApiRequestError && error.status >= 400 && error.status < 500 && error.status !== 408;
        client.setQueryData<Receipt>(cacheKey, {
          key, phase: rejected ? "rejected" : "unknown",
          error: rejected ? queueError(error, zh) : undefined,
        });
      }
    } finally {
      lock.current = false;
      if (generation === authenticationGeneration()) focusRecovery(focused);
    }
  }
  async function check() {
    const prior = current();
    if (!prior || prior.phase !== "unknown" || lock.current || retired) return;
    lock.current = true; setChecking(true); setCheckFailed(false);
    const focused = Boolean(root.current?.contains(document.activeElement));
    try {
      const access = captureOfflineAccess();
      const result = await readConversationExportRequest(conversationId, prior.key);
      assertOfflineAccess(access);
      if (result.task) accept(result.task, prior.key);
      else client.setQueryData<Receipt>(cacheKey, { ...prior, notFound: true });
    } catch {
      if (alive.current && generation === authenticationGeneration()) setCheckFailed(true);
    } finally {
      lock.current = false;
      if (alive.current && generation === authenticationGeneration()) {
        setChecking(false); focusRecovery(focused);
      }
    }
  }
  const unknown = receipt?.phase === "unknown";
  const pending = receipt?.phase === "submitting" || Boolean(jobId && !["committed", "failed", "cancelled"].includes(task.data?.status ?? ""));
  const artifactId = !deliveryDisabled && task.data?.status === "committed" ? task.data.result.artifact_id : null;
  const mustAdjust = task.data?.status === "failed" && exportNeedsAdjustment(task.data.error_message);
  const delivery = artifactId ? <ExportArtifactDelivery artifactId={artifactId} scope={scope}
    label={request.format === "context_package" ? (zh ? "下载上下文包" : "Download Context Package") : (zh ? "下载导出包" : "Download export")}
    onRegenerated={job => accept(job, receipt?.key ?? `regenerated-${job.job_id}`)} /> : null;
  const generate = (fallback = false) => <button type="button" disabled={disabled || pending}
    onClick={() => void submit()} className={`${fallback ? "btn-secondary" : "btn-primary"} min-h-11 px-3 text-sm disabled:opacity-60`}>
    {pending ? (zh ? "正在生成导出文件…" : "Preparing export…") : fallback
      ? (zh ? "按原选项在后台生成 ZIP" : "Generate a ZIP with these options")
      : (zh ? "生成导出包" : "Generate export")}
  </button>;
  if (retired) return null;
  return <div ref={root} tabIndex={-1} className="min-w-0 space-y-2 outline-none" data-testid="recoverable-export">
    {artifactId ? renderDelivery ? renderDelivery(delivery) : delivery : unknown ? <>
      <p role="status" className="text-sm text-secondary">{zh ? "提交结果待确认。原选项已保留，不会自动重新提交。" : "Submission is unconfirmed. Your options are retained; nothing is automatically resubmitted."}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={checking} onClick={() => void check()} className="btn-secondary min-h-11 px-3 text-sm">{checking ? (zh ? "正在核对…" : "Checking…") : (zh ? "核对结果" : "Check result")}</button>
        {receipt.notFound ? <button type="button" disabled={checking || disabled} onClick={() => void submit(true)} className="btn-secondary min-h-11 px-3 text-sm">{zh ? "按原请求重试" : "Retry the original request"}</button> : null}
      </div>
      {receipt.notFound ? <p className="text-xs text-secondary">{zh ? "暂未查到任务，不代表请求已失败。可以稍后再核对；手动重试沿用原请求标识，服务器会核对已有任务。" : "No task was found yet; the request may still be arriving. Check again or explicitly retry with the original request key."}</p> : null}
      {checkFailed ? <p role="alert" className="text-sm text-[var(--danger)]">{zh ? "暂时无法核对，原请求仍保留。请检查连接后再核对。" : "Could not check. The original request is retained; check your connection and try reading again."}</p> : null}
    </> : plainHref && !pending && !jobId ? <DirectExportDownload href={plainHref}
      format={request.format === "canjson_v2" ? "canjson" : "markdown"} disabled={disabled}
      backgroundAction={<div className="space-y-1">{generate(true)}<p className="text-xs text-secondary">{zh ? "ZIP 内是同一份文件，不新增附件；后台生成仍受服务器大小限制。" : "The ZIP contains the same file, with no extra attachments. Server limits still apply."}</p></div>} />
      : mustAdjust ? <p className="text-sm text-secondary">{zh ? "请先调整上方内容选项，再生成新导出。" : "Adjust the content options above before generating a new export."}</p> : generate()}
    {receipt?.phase === "rejected" ? <p role="alert" className="text-sm text-[var(--danger)]">{receipt.error}</p> : null}
    {pending ? <p role="status" className="text-xs text-secondary">{receipt?.phase === "submitting"
      ? (zh ? "正在提交，关闭面板不会取消已经接收的请求。" : "Submitting. Closing this panel does not cancel an accepted request.")
      : task.isError ? (zh ? "暂时无法读取进度，任务可能仍在运行。" : "Status is unavailable; the task may still be running.")
      : (zh ? `生成进度 ${task.data?.progress ?? 0}%` : `Progress ${task.data?.progress ?? 0}%`)}</p> : null}
    {task.isError && jobId ? <button type="button" disabled={task.isFetching} onClick={() => void task.refetch()} className="btn-secondary min-h-11 px-3 text-sm">{zh ? "重新读取进度" : "Read status again"}</button> : null}
    {task.data?.status === "failed" ? <p role="alert" className="text-sm text-[var(--danger)]">{batchExportError(task.data.error_message, zh)}</p> : null}
    {task.data?.status === "cancelled" ? <p className="text-sm text-secondary">{zh ? "生成已取消，选项仍保留。" : "Export cancelled. Your options are retained."}</p> : null}
  </div>;
}

function queueError(error: ApiRequestError, zh: boolean): string {
  if (error.code) return batchExportError(error.code, zh);
  if (error.status === 401) return zh ? "登录已过期，请重新登录。" : "Your session expired. Sign in again.";
  if (error.status === 403 || error.status === 404) return zh ? "对话不可访问，请返回列表确认。" : "The conversation is unavailable. Check your list.";
  if (error.status === 413) return zh ? "超过服务器大小限制，请减少内容后重试。" : "The server size limit was exceeded. Reduce the content and retry.";
  if (error.status === 409) return zh ? "内容或请求已变化，选项仍保留，请重新检查。" : "The source or request changed. Your options are retained; review them again.";
  return zh ? "请求未被接受，选项仍保留。请检查选项后重试。" : "The request was not accepted. Your options are retained; review them and retry.";
}
