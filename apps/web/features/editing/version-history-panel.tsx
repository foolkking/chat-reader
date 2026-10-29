"use client";

import { ChevronLeft, ChevronRight, History, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import type { MessageVersionHistoryController, VersionFeedback, VersionIssue } from "./use-message-version-history";
import { buildVersionDiff, versionText } from "./version-diff";

export function VersionHistoryPanel({ controller, mobile = false }: {
  controller: MessageVersionHistoryController;
  mobile?: boolean;
}) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const liveScope = useRef(controller.scope);
  liveScope.current = controller.scope;
  const [openScope, setOpenScope] = useState<object | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const open = openScope === controller.scope;
  const { versions, current, currentIndex, feedback, phase } = controller;
  const compareVersion = compareId ? versions.find((item) => item.id === compareId) ?? null : null;
  const comparison = compareVersion && current && compareVersion.id !== current.id
    ? buildVersionDiff(versionText(compareVersion), versionText(current))
    : null;
  const busy = phase !== "idle";
  const warning = feedback ? feedbackText(feedback, zh)
    : controller.readFailed ? readFailureText(controller.readIssue, zh)
      : controller.headMismatch ? (zh ? "历史与当前正文不一致，请核对最新版本。" : "History and the visible message differ. Check the latest version.")
        : null;

  function close() {
    if (liveScope.current !== controller.scope) return;
    setOpenScope(null);
    setCompareId(null);
    trigger.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || liveScope.current !== controller.scope || !panel.current?.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpenScope(null);
      trigger.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [open, controller.scope]);
  useEffect(() => {
    setCompareId(null);
  }, [controller.scope, current?.id]);

  if (!controller.active) return null;
  if (controller.loading && versions.length === 0) {
    return <span className="inline-flex h-10 w-10 animate-pulse rounded-lg bg-subtle motion-reduce:animate-none" aria-label={zh ? "正在加载版本" : "Loading versions"} />;
  }
  const label = controller.needsAttention ? (zh ? "检查版本" : "Check versions")
    : currentIndex >= 0 ? `${currentIndex + 1} / ${versions.length}` : (zh ? "版本" : "Versions");

  return (
    <div className={`relative flex items-center gap-1 ${mobile ? "w-full flex-wrap" : ""}`} data-testid="message-version-control" aria-busy={busy || controller.refreshing}>
      <button type="button" disabled={!controller.canWrite || currentIndex <= 0} onClick={() => void controller.select(currentIndex - 1)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle disabled:opacity-30" aria-label={zh ? "上一版" : "Previous version"} title={zh ? "上一版" : "Previous version"}><ChevronLeft className="h-4 w-4" /></button>
      <button ref={trigger} type="button" onClick={() => { if (liveScope.current === controller.scope) setOpenScope(open ? null : controller.scope); }} className={`inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-subtle ${controller.needsAttention ? "text-[var(--color-semantic-warning)]" : "text-secondary"}`} aria-label={controller.needsAttention ? (zh ? "检查版本" : "Check versions") : (zh ? "版本详情" : "Version details")} title={zh ? "版本详情" : "Version details"} aria-expanded={open} aria-controls={panelId}><History className="h-4 w-4" /><span>{label}</span></button>
      <button type="button" disabled={!controller.canWrite || currentIndex < 0 || currentIndex >= versions.length - 1} onClick={() => void controller.select(currentIndex + 1)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-secondary hover:bg-subtle disabled:opacity-30" aria-label={zh ? "下一版" : "Next version"} title={zh ? "下一版" : "Next version"}><ChevronRight className="h-4 w-4" /></button>
      {open ? (
        <section ref={panel} id={panelId} className={`rounded-lg border border-ui bg-raised p-3 ${mobile ? "w-full basis-full" : "absolute right-0 top-11 z-50 max-h-[min(70dvh,32rem)] w-[min(26rem,calc(100vw-2rem))] overflow-auto overscroll-contain shadow-2xl"}`} aria-label={zh ? "版本详情面板" : "Version details panel"}>
          <header className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-primary">{current ? `${zh ? "版本" : "Version"} v${current.version_number}` : (zh ? "版本历史" : "Version history")}</h3>
              {current ? <p className="mt-1 text-xs text-secondary">{new Date(current.created_at).toLocaleString(resolvedLocale)} · {current.edit_type}</p> : null}
            </div>
            <button type="button" onClick={close} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭版本详情" : "Close version details"}><X className="h-4 w-4" /></button>
          </header>
          {warning ? (
            <div className="mt-2 border-l-2 border-[var(--color-semantic-warning)] pl-3">
              <p className="text-sm text-primary" role="status">{warning}</p>
              {controller.readFailed && feedback && feedback.kind !== "read-error" ? <p className="mt-1 text-xs text-secondary">{readFailureText(controller.readIssue, zh)}</p> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void controller.checkCurrent()} className="btn-secondary min-h-11 text-sm disabled:opacity-40">{phase === "checking" ? (zh ? "正在核对…" : "Checking…") : (zh ? "核对当前状态" : "Check current state")}</button>
                {feedback?.kind === "checked" ? <button type="button" disabled={busy || controller.refreshing || controller.readFailed || controller.headMismatch || feedback.matched === false} onClick={controller.continueAfterCheck} className="btn-secondary min-h-11 text-sm disabled:opacity-40">{zh ? "继续使用当前状态" : "Continue with current state"}</button> : null}
              </div>
            </div>
          ) : null}
          {busy && phase !== "checking" ? <p className="mt-2 text-xs text-secondary" role="status">{phase === "confirming" ? (zh ? "正在等待删除确认。" : "Waiting for deletion confirmation.") : (zh ? "正在更新版本…" : "Updating version…")}</p> : null}
          {!warning && controller.refreshing ? <p className="mt-2 text-xs text-secondary" role="status">{zh ? "正在读取最新版本…" : "Reading the latest version…"}</p> : null}
          {controller.derivedJobId ? (
            <div className="mt-2">
              <p className="text-xs text-secondary" role="status">{controller.derivedReadFailed
                ? (zh ? "正文变更已保存，但后台索引状态未能读取。" : "The content change was saved, but the background index status could not be read.")
                : controller.derivedTerminal
                  ? (zh ? "正文变更已保存，但搜索和章节目录更新未完成。请在任务中心查看。" : "The content change was saved, but search and section updates did not finish. Check Tasks.")
                  : (zh ? "正文变更已保存，搜索和章节目录正在后台更新。" : "The content change was saved. Search and sections are updating in the background.")}</p>
              {controller.derivedReadFailed ? <button type="button" disabled={busy} onClick={() => void controller.checkDerived()} className="btn-secondary mt-2 min-h-11 text-sm disabled:opacity-40">{zh ? "核对后台状态" : "Check background status"}</button> : null}
              {controller.derivedTerminal ? <button type="button" onClick={() => { close(); window.dispatchEvent(new Event("chat-reader:open-task-center")); }} className="btn-secondary mt-2 min-h-11 text-sm">{zh ? "打开任务中心" : "Open Tasks"}</button> : null}
            </div>
          ) : null}
          {current ? (
            <>
              {current.edit_reason ? <p className="mt-2 text-xs text-secondary">{current.edit_reason}</p> : null}
              <pre className={`mt-3 overflow-auto whitespace-pre-wrap rounded-lg bg-subtle p-3 text-xs leading-5 text-primary ${mobile ? "max-h-40" : "max-h-64"}`}>{current.display_text || current.plain_text || ""}</pre>
              {versions.length > 1 ? (
                <div className="mt-4 border-t border-ui pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-semibold text-primary">{zh ? "只读比较" : "Read-only comparison"}</h4>
                      <p className="mt-1 text-xs text-secondary">{zh ? "只读取历史，不会切换或保存版本。" : "Reads history only; it never switches or saves a version."}</p>
                    </div>
                    <select
                      aria-label={zh ? "选择要比较的版本" : "Choose a version to compare"}
                      value={compareId ?? ""}
                      onChange={(event) => setCompareId(event.target.value || null)}
                      className="min-h-10 max-w-full rounded-lg border border-ui bg-surface px-2 text-xs text-primary"
                    >
                      <option value="">{zh ? "选择历史版本" : "Choose a history version"}</option>
                      {versions.filter((item) => item.id !== current.id).map((item) => (
                        <option key={item.id} value={item.id}>
                          v{item.version_number} · {new Date(item.created_at).toLocaleString(resolvedLocale)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {compareVersion && comparison ? (
                    <div className="mt-3">
                      <p className="text-xs text-secondary">
                        {zh ? `v${compareVersion.version_number} → 当前 v${current.version_number}` : `v${compareVersion.version_number} → current v${current.version_number}`}
                        {comparison.truncated ? (zh ? "（比较已限制范围）" : " (comparison bounded)") : ""}
                      </p>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-ui bg-page p-2 text-xs leading-5">
                        {comparison.lines.map((line, index) => (
                          <span
                            key={`${index}-${line.kind}`}
                            className={`block px-1 ${line.kind === "added" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : line.kind === "removed" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "text-secondary"}`}
                          >
                            {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}{line.text || " "}
                          </span>
                        ))}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-3 flex justify-end">
                <button type="button" disabled={!current.can_delete || !controller.canWrite} onClick={() => void controller.remove()} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-40" title={current.is_initial ? (zh ? "初始版本不能删除" : "The initial version cannot be deleted") : (zh ? "永久删除版本" : "Permanently delete version")}><Trash2 className="h-4 w-4" />{current.is_initial ? (zh ? "初始版本受保护" : "Initial version protected") : (zh ? "永久删除" : "Delete permanently")}</button>
              </div>
            </>
          ) : !warning && !controller.refreshing ? (
            <div className="mt-2 text-sm text-secondary">
              <p>{zh ? "没有可用的版本历史。可重新读取当前消息。" : "No version history is available. Read the current message again."}</p>
              <button type="button" disabled={busy} onClick={() => void controller.checkCurrent()} className="btn-secondary mt-2 min-h-11 text-sm disabled:opacity-40">{zh ? "核对当前状态" : "Check current state"}</button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function readFailureText(issue: VersionIssue, zh: boolean): string {
  if (issue === "session") return zh ? "登录状态已过期，请重新登录后读取版本。" : "Your session expired. Sign in again to read versions.";
  if (issue === "permission") return zh ? "当前权限不允许读取此消息的版本。" : "Your current permissions do not allow reading this message's versions.";
  if (issue === "missing") return zh ? "消息或版本已不存在，请刷新对话。" : "The message or version is no longer available. Refresh the conversation.";
  if (issue === "limited") return zh ? "读取过于频繁，请稍后再核对。" : "Too many reads. Check again shortly.";
  return zh ? "版本未能完整读取；已有预览仅供参考，请重新核对。" : "Versions could not be fully read. Any existing preview is for reference; check again.";
}

function feedbackText(feedback: VersionFeedback, zh: boolean): string {
  if (feedback.kind === "unconfirmed") return zh ? "版本操作结果尚未确认。请先核对当前正文和历史，不要重复提交。" : "The version operation is unconfirmed. Check the current message and history before submitting again.";
  if (feedback.kind === "checked") return zh ? "已读取当前正文和历史，但没有原请求回执。确认当前内容后，可继续使用此状态。" : "The current message and history were read, but there is no receipt for the earlier request. Review the content before continuing with this state.";
  if (feedback.kind === "refresh-failed") return zh ? "版本操作已保存，但正文未能同步刷新。请核对当前状态，无需重发操作。" : "The version operation was saved, but the visible message could not refresh. Check the current state; do not resubmit.";
  if (feedback.kind === "stale") return zh ? "版本状态已变化或读取结果不一致。请重新核对后再操作。" : "The version state changed or the reads differ. Check again before making another change.";
  if (feedback.kind === "read-error") return readFailureText(feedback.issue ?? "service", zh);
  if (feedback.issue === "session") return zh ? "登录状态已过期，请重新登录后再修改版本。" : "Your session expired. Sign in again before changing versions.";
  if (feedback.issue === "permission") return zh ? "当前权限不允许修改此消息的版本。" : "Your current permissions do not allow changing this message's versions.";
  if (feedback.issue === "missing") return zh ? "消息或版本已不存在，请核对当前状态。" : "The message or version is no longer available. Check the current state.";
  if (feedback.issue === "conflict") return zh ? "消息版本已变化，请核对后重新选择。" : "The message version changed. Check it before choosing again.";
  if (feedback.issue === "limited") return zh ? "请求过于频繁，请稍后核对再操作。" : "Too many requests. Check the state shortly before trying again.";
  return zh ? "版本请求未被接受，请核对当前状态后重新选择。" : "The version request was not accepted. Check the current state before choosing again.";
}
