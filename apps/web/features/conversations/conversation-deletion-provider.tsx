"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import { usePreferences } from "../../components/preferences-provider";
import { ApiRequestError, getConversationBatchDeleteRequest, queueConversationBatchDelete } from "../../lib/api";
import { latestArchiveTask } from "../../lib/archive-task-state";
import { getCurrentOfflineRuntimeUserId } from "../../lib/auth-client";
import { authenticationGeneration, OFFLINE_ACCESS_LOCKED_EVENT, offlineAuthenticationRequired } from "../../lib/offline-access";
import type { BackgroundTaskRead } from "../../lib/types";

type Phase = "confirming" | "submitting" | "unknown" | "checking" | "missing" | "confirmed" | "rejected";
type Reason = "unknown" | "check" | "access" | "unavailable" | "invalid" | "rate" | "conflict" | "start";
type Request = {
  key: string; ids: string[]; owner: string | null; epoch: number;
  phase: Phase; reason: Reason; hidden: boolean; task?: BackgroundTaskRead;
};
type Controller = {
  busy: boolean;
  submit: (ids: string[], title?: string) => Promise<BackgroundTaskRead | undefined>;
};
const DeletionContext = createContext<Controller | null>(null);
const busy = (phase: Phase) => ["confirming", "submitting", "checking"].includes(phase);
const unresolved = (phase: Phase) => !["confirmed", "rejected"].includes(phase);

/** One bounded admission owner survives row/menu closure and private-route navigation.
 * No automatic writes, receipt polling, or persistent conversation IDs are added. */
export function ConversationDeletionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const dialog = useInteractionDialog();
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const pathname = usePathname();
  const hasTaskCenter = pathname === "/" || pathname === "/archived" || pathname === "/recent"
    || pathname === "/search" || pathname?.startsWith("/conversations/") || pathname?.startsWith("/projects/");
  const owner = getCurrentOfflineRuntimeUserId();
  const epoch = authenticationGeneration();
  const path = useRef({ pathname, visit: 0 });
  if (path.current.pathname !== pathname) path.current = { pathname, visit: path.current.visit + 1 };
  const mounted = useRef(true);
  const current = useRef<Request | null>(null);
  const flight = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<Request | null>(null);
  const active = (request: Request) => mounted.current && current.current === request
    && request.epoch === authenticationGeneration() && request.owner === getCurrentOfflineRuntimeUserId()
    && (request.owner !== null || !offlineAuthenticationRequired());
  const publish = (request: Request, phase = request.phase) => {
    if (!active(request)) return;
    request.phase = phase;
    setSnapshot({ ...request });
  };

  useEffect(() => {
    mounted.current = true;
    const retire = () => {
      current.current = null;
      flight.current?.abort();
      flight.current = null;
      setSnapshot(null);
    };
    if (current.current && !active(current.current)) retire();
    window.addEventListener(OFFLINE_ACCESS_LOCKED_EVENT, retire);
    return () => {
      mounted.current = false;
      current.current = null;
      flight.current?.abort();
      flight.current = null;
      window.removeEventListener(OFFLINE_ACCESS_LOCKED_EVENT, retire);
    };
    // Both live checks and cleanup fence a new account before passive effects.
  }, [owner, epoch]);

  const acknowledge = (request: Request, task: BackgroundTaskRead, showRecovery: boolean) => {
    if (!active(request)) return;
    request.task = task;
    publish(request, "confirmed");
    // Admission is confirmed independently of task-list refresh.
    try {
      queryClient.setQueryData<BackgroundTaskRead[]>(["active-tasks"], (items = []) => {
        const previous = items.find(item => item.job_id === task.job_id);
        const latest = latestArchiveTask(previous, task, 0, Date.now()) ?? task;
        return [latest, ...items.filter(item => item.job_id !== task.job_id)];
      });
      void queryClient.invalidateQueries({ queryKey: ["active-tasks"] }).catch(() => {});
    } catch { /* A cache notification failure cannot turn confirmed admission into unknown. */ }
    if (!showRecovery) { current.current = null; setSnapshot(null); }
  };

  const send = async (request: Request, showRecovery: boolean, origin?: number): Promise<BackgroundTaskRead | undefined> => {
    if (!active(request) || flight.current) return;
    const controller = new AbortController();
    flight.current = controller;
    publish(request, "submitting");
    try {
      const task = await queueConversationBatchDelete(request.ids, request.key, controller.signal);
      if (!active(request)) return;
      acknowledge(request, task, showRecovery || (origin !== undefined && origin !== path.current.visit));
      return task;
    } catch (error) {
      if (!active(request)) return;
      request.reason = deletionFailure(error);
      publish(request, request.reason === "unknown" ? "unknown" : "rejected");
    } finally {
      if (flight.current === controller) flight.current = null;
    }
  };

  const submit: Controller["submit"] = async (ids, title) => {
    if (!mounted.current || (offlineAuthenticationRequired() && !getCurrentOfflineRuntimeUserId())) return;
    const pending = current.current;
    if (pending && active(pending) && unresolved(pending.phase)) {
      pending.hidden = false; publish(pending); return;
    }
    if (flight.current) return;
    const orderedIds = [...new Set(ids)];
    if (!orderedIds.length || orderedIds.length > 5000) return;
    const request: Request = {
      key: "", ids: orderedIds,
      owner: getCurrentOfflineRuntimeUserId(), epoch: authenticationGeneration(),
      phase: "confirming", reason: "unknown", hidden: false,
    };
    const origin = path.current.visit;
    // Set the live owner before awaiting confirmation; a rapid second click
    // cannot replace the confirmation resolver or create a second admission.
    current.current = request;
    publish(request);
    try { request.key = `conversation-delete-${crypto.randomUUID()}`; }
    catch { request.reason = "start"; publish(request, "rejected"); return; }
    const confirmed = await dialog.confirm({
      title: title
        ? (zh ? `永久删除“${title}”？` : `Permanently delete “${title}”?`)
        : (zh ? `永久删除 ${orderedIds.length} 个对话？` : `Permanently delete ${orderedIds.length} conversations?`),
      description: zh
        ? "这些对话会在后台按列表顺序逐项删除，无法在系统内恢复。可在任务中心查看进度并停止后续删除。"
        : "These conversations are deleted in order in the background and cannot be restored in the app. Track progress or stop pending items in the task center.",
      confirmLabel: zh ? "永久删除" : "Delete permanently", danger: true,
    });
    if (!active(request)) return;
    if (!confirmed || origin !== path.current.visit) { current.current = null; setSnapshot(null); return; }
    const task = await send(request, false, origin);
    // Navigation after admission must not redirect or clear a new list's selection.
    return origin === path.current.visit && request.epoch === authenticationGeneration() ? task : undefined;
  };

  const check = async () => {
    const request = current.current;
    if (!request || !active(request) || flight.current || !["unknown", "missing"].includes(request.phase)) return;
    const controller = new AbortController();
    flight.current = controller;
    publish(request, "checking");
    try {
      const result = await getConversationBatchDeleteRequest(request.key, controller.signal);
      if (!active(request)) return;
      if (result.found && result.task?.job_type === "conversation_batch_delete") acknowledge(request, result.task, true);
      else if (result.found === false && result.task === null) publish(request, "missing");
      else { request.reason = "check"; publish(request, "unknown"); }
    } catch {
      if (active(request)) { request.reason = "check"; publish(request, "unknown"); }
    } finally {
      if (flight.current === controller) flight.current = null;
    }
  };
  const retry = async () => {
    const request = current.current;
    if (!request || !active(request) || flight.current || request.phase !== "missing") return;
    const origin = path.current.visit;
    publish(request, "confirming");
    const confirmed = await dialog.confirm({
      title: zh ? `重试原来的 ${request.ids.length} 个对话删除请求？` : `Retry the original deletion of ${request.ids.length} conversations?`,
      description: zh
        ? "仅重试原先确认的目标，不使用当前选择。删除无法在系统内恢复；如果原任务已经受理，将返回同一任务。"
        : "Only the originally confirmed targets are retried, not your current selection. Deletion cannot be restored in the app. An already accepted request returns the same task.",
      confirmLabel: zh ? "重试原请求" : "Retry original request", danger: true,
    });
    if (!active(request)) return;
    if (!confirmed || origin !== path.current.visit) { publish(request, "missing"); return; }
    await send(request, true);
  };
  const dismiss = () => {
    const request = current.current;
    if (!request || !active(request) || busy(request.phase)) return;
    if (unresolved(request.phase)) { request.hidden = true; publish(request); }
    else { current.current = null; setSnapshot(null); }
  };
  const visible = snapshot && snapshot.owner === owner && snapshot.epoch === epoch ? snapshot : null;
  const show = visible && !["confirming", "submitting"].includes(visible.phase);
  return <DeletionContext.Provider value={{ busy: !!visible && busy(visible.phase), submit }}>
    {children}
    {visible && show ? <section aria-label={zh ? "删除请求恢复" : "Deletion request recovery"}
      className="fixed inset-x-3 z-[240] mx-auto max-w-lg rounded-lg border border-ui bg-raised px-4 py-3 text-sm text-secondary"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
      {visible.hidden ? <button type="button" className="btn-secondary min-h-11 w-full px-3"
        onClick={() => { const request = current.current; if (request && active(request)) { request.hidden = false; publish(request); } }}>
        {zh ? "查看未确认的删除请求" : "Review unconfirmed deletion"}
      </button> : <>
        <div role={visible.phase === "confirmed" ? "status" : "alert"} aria-atomic="true">
          <p className="font-semibold text-primary">{visible.phase === "confirmed"
            ? (zh ? "已找到原删除任务" : "Original deletion task found")
            : visible.phase === "rejected" ? (zh ? "删除请求未受理" : "Deletion request not accepted")
              : (zh ? "删除结果尚未确认" : "Deletion result is unconfirmed")}</p>
          <p className="mt-1">{deletionMessage(visible, zh)}</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {["unknown", "missing", "checking"].includes(visible.phase) ? <button type="button"
            className="btn-secondary min-h-11 px-3" disabled={busy(visible.phase)} onClick={() => void check()}>
            {visible.phase === "checking" ? (zh ? "正在核对…" : "Checking…") : (zh ? "核对删除结果" : "Check deletion request")}
          </button> : null}
          {visible.phase === "missing" ? <button type="button" className="btn-secondary min-h-11 px-3 text-[var(--danger)]"
            onClick={() => void retry()}>{zh ? "使用原请求重试" : "Retry original request"}</button> : null}
          {hasTaskCenter ? <button type="button" className="btn-secondary min-h-11 px-3"
            onClick={() => window.dispatchEvent(new Event("chat-reader:open-task-center"))}>
            {zh ? "任务中心" : "Task center"}
          </button> : <Link className="btn-secondary inline-flex min-h-11 items-center px-3" href="/">
            {zh ? "返回列表查看任务" : "Go to conversations"}
          </Link>}
          <button type="button" className="btn-secondary min-h-11 px-3" disabled={busy(visible.phase)} onClick={dismiss}>
            {unresolved(visible.phase) ? (zh ? "收起" : "Minimize") : (zh ? "关闭" : "Close")}
          </button>
        </div>
      </>}
    </section> : null}
  </DeletionContext.Provider>;
}

export function useConversationDeletion(): Controller {
  const value = useContext(DeletionContext);
  if (!value) throw new Error("Conversation deletion must use its shared provider.");
  return value;
}

function deletionFailure(error: unknown): Reason {
  if (!(error instanceof ApiRequestError)) return "unknown";
  if (error.code === "DELETE_REQUEST_CONFLICT") return "conflict";
  if ([401, 403].includes(error.status)) return "access";
  if (error.status === 404) return "unavailable";
  if (error.status === 429) return "rate";
  if ([400, 422].includes(error.status)) return "invalid";
  return "unknown";
}

function deletionMessage(request: Request, zh: boolean): string {
  if (request.phase === "confirmed") return zh
    ? "请到任务中心查看当前进度或部分删除结果。已失败或取消的任务没有自动重新启动。"
    : "Check progress or partial deletion results in the task center. Failed or cancelled work was not automatically restarted.";
  if (request.phase === "missing") return zh
    ? "本次核对没有找到原任务。可以再次核对，或明确确认后用原请求重试；不会使用当前选择。"
    : "This check found no original task. Check again or explicitly confirm a retry of the original request, not your current selection.";
  if (request.phase === "rejected") {
    const copy: Record<Exclude<Reason, "unknown" | "check">, [string, string]> = {
      access: ["当前账户无法提交删除，请确认登录状态与权限后重新选择。", "This account cannot submit deletion. Check sign-in and permission before selecting again."],
      unavailable: ["部分对话已不存在或不可访问。请刷新列表并重新选择；没有创建新的删除任务。", "Some conversations are unavailable. Refresh the list and select again; no new deletion task was created."],
      invalid: ["删除范围未被接受。请刷新列表并重新选择；没有创建新的删除任务。", "The deletion targets were not accepted. Refresh the list and select again; no new deletion task was created."],
      rate: ["操作过于频繁，请稍后重新选择并确认删除。", "Too many requests. Wait before selecting and confirming deletion again."],
      conflict: ["此请求键已绑定其他删除目标，本次提交未受理。请先到任务中心核对。", "This request key belongs to other deletion targets; this submission was not accepted. Check the task center first."],
      start: ["浏览器无法准备删除请求，本次尚未提交。请重新打开此页面后再确认。", "The browser could not prepare deletion; nothing was submitted. Reopen this page before confirming again."],
    };
    if (request.reason !== "unknown" && request.reason !== "check") return copy[request.reason][zh ? 0 : 1];
  }
  return request.reason === "check"
    ? (zh ? "暂时无法核对原请求，不代表任务不存在。请稍后再核对；不会自动再次删除。"
      : "The original request could not be checked. This does not mean it is missing. Check again later; deletion is not automatically resubmitted.")
    : (zh ? "服务器可能已受理。请先只读核对原请求，再决定下一步；当前选择仍保留。"
      : "The server may have accepted this request. Check its receipt before deciding what to do next; your selection is retained.");
}
