"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, AdminRequestError, type AdminExecutionResult, type AdminExecutionSnapshot } from "../lib/admin-client";
import { authenticationGeneration } from "../lib/offline-access";
import { withRequestDeadline } from "../lib/request-deadline";

type Notice = "read_failed" | "unknown" | "changed" | "denied" | null;

/** On-demand privileged control, separate from the content-free runtime summary. */
export function AdminExecutionRecovery({ generation, zh, locale, onClose }: {
  generation: number; zh: boolean; locale: string; onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<AdminExecutionSnapshot | null>(null);
  const [selected, setSelected] = useState<AdminExecutionResult | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const checkButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const run = useCallback(async (mode: "load" | "check" | "stop", target?: AdminExecutionResult) => {
    if (busyRef.current || generation !== authenticationGeneration()) return;
    const revision = ++sequence.current;
    const abort = new AbortController();
    controller.current = abort;
    busyRef.current = true; setBusy(true); setConfirm(false);
    const current = () => revision === sequence.current && generation === authenticationGeneration() && !abort.signal.aborted;
    try {
      if (mode === "load") {
        const next = await withRequestDeadline(signal => adminApi.runtimeExecution(signal), abort.signal, 15_000);
        if (!current()) return;
        setSnapshot(next); setSelected(next.current ?? next.last_stop);
      } else if (target) {
        const next = await withRequestDeadline(signal => mode === "stop"
          ? adminApi.stopRuntimeExecution(target.identity, signal)
          : adminApi.runtimeExecutionResult(target.identity, signal), abort.signal, 15_000);
        if (!current()) return;
        setSelected(next);
      }
      if (current()) setNotice(null);
    } catch (error) {
      if (!current()) return;
      if (error instanceof AdminRequestError && [401, 403, 404].includes(error.status)) {
        setNotice("denied"); setSelected(null); setSnapshot(null);
      } else if (mode === "stop") {
        // A timeout releases the UI, never reissues a mutation or changes target.
        setNotice(error instanceof AdminRequestError && error.code === "TASK_EXECUTION_CHANGED" ? "changed" : "unknown");
      } else setNotice("read_failed");
    } finally {
      if (current()) {
        busyRef.current = false; setBusy(false);
        if (mode === "stop") checkButton.current?.focus({ preventScroll: true });
      }
    }
  }, [generation]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    void run("load");
    return () => { sequence.current++; controller.current?.abort(); busyRef.current = false; };
  }, [run]);
  useEffect(() => {
    if (confirm) confirmButton.current?.focus({ preventScroll: true });
  }, [confirm]);

  const family = (value: string) => ({
    import: zh ? "导入" : "Import", export: zh ? "导出" : "Export", merge: zh ? "合并" : "Merge",
    offline: zh ? "离线更新" : "Offline update", restore: zh ? "归档恢复" : "Archive restore",
    delete: zh ? "删除" : "Deletion", rebuild: zh ? "重建索引" : "Index rebuild",
    notification: zh ? "通知发送" : "Notification", cleanup: zh ? "清理" : "Cleanup",
    context: zh ? "上下文更新" : "Context update",
  })[value] ?? (zh ? "后台任务" : "Background task");
  const status = (value: string | null) => ({
    committed: zh ? "业务已完成" : "Operation completed", cancelled: zh ? "业务已停止" : "Operation stopped",
    failed: zh ? "业务未完成，由发起账户回原任务处理" : "Operation unfinished; the initiating account can recover from its original task", queued: zh ? "等待执行" : "Queued",
    processing: zh ? "业务处理中" : "Operation processing", cancelling: zh ? "业务停止中" : "Operation stopping",
  })[value ?? ""] ?? (zh ? "状态待核对" : "Status needs checking");
  const errors = {
    read_failed: zh ? "核对失败，上次结果可能已过时。请重新核对；没有再次发送停止请求。" : "The check failed; the previous result may be outdated. Check again. No stop request was resent.",
    unknown: zh ? "停止请求结果待确认。核对原执行，不会自动重发。" : "The stop request is unconfirmed. Check the original execution; it will not be resent automatically.",
    changed: zh ? "执行已变化，没有停止新的执行。请核对原结果。" : "The execution changed. The new execution was not stopped. Check the original result.",
    denied: zh ? "管理权限不可用。恢复访问后重新读取。" : "Administrator access is unavailable. Restore access, then read again.",
  };
  const same = (a: AdminExecutionResult | null | undefined, b: AdminExecutionResult | null) =>
    Boolean(a && b && a.identity.execution_token === b.identity.execution_token);
  const switchTarget = (value: AdminExecutionResult) => { setSelected(value); void run("check", value); };
  return <section aria-label={zh ? "执行处理" : "Execution recovery"} className="space-y-3 border-y border-ui py-4"
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <div className="flex items-center justify-between gap-3">
      <h3 ref={heading} tabIndex={-1} className="text-sm font-semibold">{zh ? "执行处理" : "Execution recovery"}</h3>
      <button type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={onClose}>{zh ? "关闭" : "Close"}</button>
    </div>
    {notice ? <p role="alert" className="text-sm text-[var(--danger)]">{errors[notice]}</p> : null}
    {selected ? <>
      <p className="break-words text-sm font-medium">{family(selected.family)} · {selected.owner?.label ?? (zh ? "系统任务" : "System task")}</p>
      <p className="text-xs leading-5 text-secondary">{zh ? "开始：" : "Started: "}
        {selected.started_at ? new Date(selected.started_at).toLocaleString(locale) : "—"}
        {selected.progress_age_seconds !== null ? ` · ${zh ? "最近推进：" : "Last progress: "}${selected.progress_age_seconds}s` : ""}
      </p>
      <p role="status" className="text-sm text-secondary">{status(selected.canonical_status)} · {
        selected.state === "stopping" ? (zh ? "等待执行退出并核对结果，尚未释放队列。" : "Waiting for exit and outcome checks; the queue is not released yet.")
          : selected.state === "reconciling" ? (zh ? "正在核对执行结果，不重复提交业务。" : "Checking the execution outcome; no operation is replayed.")
          : selected.state === "finished" ? (zh ? "执行已结束并完成核对。" : "Execution ended and was reconciled.")
          : selected.state === "changed" ? (zh ? "此执行已不在当前执行槽；以上仅为原任务结果。" : "This execution is no longer in the current slot; this is the original task's result.")
          : selected.state === "stalled" ? (zh ? "暂未推进，可请求停止后由后台核对。" : "No recent progress. You can request a stop and let the worker reconcile.")
          : (zh ? "执行中。" : "Running.")}
      </p>
      {selected.stop_recorded_at ? <p className="text-xs text-secondary">{zh ? "停止请求已记录：" : "Stop request recorded: "}{new Date(selected.stop_recorded_at).toLocaleString(locale)}</p> : null}
      {selected.source_disposition === "discard" ? <p className="text-sm text-secondary">{zh
        ? "此前已有明确放弃来源的请求，本操作不会修改该决定。"
        : "A prior explicit source-discard request is already recorded. This action does not change it."}</p> : null}
    </> : !busy && snapshot ? <p className="text-sm text-secondary">{snapshot.untracked
      ? (zh ? "存在旧执行，但缺少可靠的执行身份。请由运维检查执行进程与数据库锁；此处不会重置任务或启动第二个执行。" : "An older execution has no verifiable identity. An operator must check the process and database lock; this page will not reset it or start another execution.")
      : (zh ? "当前没有待处理执行，也没有管理员停止记录。" : "No execution needs attention and no administrator stop is recorded.")}</p> : null}
    {confirm ? <div className="space-y-2">
      <p className="text-sm text-secondary">{zh
        ? "仅请求停止这一次执行并保留来源。已完成的步骤或已发出的通知不会回滚；不会自动重试。"
        : "Stop only this execution and retain its sources. Completed steps or sent notifications cannot be undone; no automatic retry."}</p>
      <div className="flex flex-wrap gap-2">
        <button ref={confirmButton} type="button" className="btn-secondary min-h-11 px-3 text-sm" disabled={busy} onClick={() => selected && void run("stop", selected)}>{zh ? "确认停止" : "Confirm stop"}</button>
        <button type="button" className="btn-secondary min-h-11 px-3 text-sm" onClick={() => { setConfirm(false); checkButton.current?.focus({ preventScroll: true }); }}>{zh ? "继续等待" : "Keep waiting"}</button>
      </div>
    </div> : null}
    <div className="flex flex-wrap gap-2">
      <button ref={checkButton} type="button" className="btn-secondary min-h-11 px-3 text-sm" aria-busy={busy} onClick={() => void run(selected ? "check" : "load", selected ?? undefined)}>{busy ? (zh ? "核对中…" : "Checking…") : (zh ? "核对结果" : "Check result")}</button>
      {selected?.stop_allowed && !confirm && !notice ? <button type="button" className="btn-secondary min-h-11 px-3 text-sm" disabled={busy} onClick={() => setConfirm(true)}>{zh ? "停止并保留来源" : "Stop and retain sources"}</button> : null}
      {snapshot?.last_stop && !same(snapshot.last_stop, selected) && !notice ? <button type="button" className="btn-secondary min-h-11 px-3 text-sm" disabled={busy} onClick={() => switchTarget(snapshot.last_stop!)}>{zh ? "上次停止结果" : "Previous stop result"}</button> : null}
      {snapshot?.current && !same(snapshot.current, selected) && !notice ? <button type="button" className="btn-secondary min-h-11 px-3 text-sm" disabled={busy} onClick={() => switchTarget(snapshot.current!)}>{zh ? "当前执行" : "Current execution"}</button> : null}
    </div>
  </section>;
}
