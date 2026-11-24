"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, getBatchExportRequest, queueConversationBatchExport, type ProjectExportReview, type ProjectExportScope } from "../../lib/api";
import { batchExportError, batchExportFailureCode } from "../../lib/batch-export-errors";
import { batchIntentDigest, readBatchReceipt, type BatchReceipt } from "../../lib/batch-export-receipt";
import { getCurrentOfflineRuntimeUserId } from "../../lib/auth-client";
import { authenticationGeneration, AUTH_GENERATION_CHANGED_EVENT, OFFLINE_ACCESS_LOCKED_EVENT } from "../../lib/offline-access";
import type { BackgroundTaskRead } from "../../lib/types";

export const BATCH_EXPORT_SELECTION_LIMIT = 5000;
const control = "min-h-11 rounded-md px-2 text-sm font-medium text-accent underline underline-offset-2 disabled:opacity-50";
function openTasks() { window.dispatchEvent(new Event("chat-reader:open-task-center")); }
type Change = { ids: string[]; selection: string[]; origin: ProjectExportScope; review: ProjectExportReview };
type View = { slot: string; epoch: number; error?: string; accepted?: boolean; unresolved?: boolean; notFound?: boolean; change?: Change };

export function useBatchExport(zh: boolean, surface = "conversations", selection?:readonly string[]) {
  const queryClient = useQueryClient();
  const owner = getCurrentOfflineRuntimeUserId();
  const slot = `chat-reader:batch-export:${owner ?? "local"}:${surface}`;
  const epoch = authenticationGeneration();
  const current = useRef({ slot, epoch });
  current.current = { slot, epoch };
  const mounted = useRef(false);
  const flight = useRef<AbortController | null>(null);
  const pending = useRef<BatchReceipt | null>(null);
  const locallySent = useRef("");
  const verifiedAbsent = useRef("");
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const active = () => mounted.current && current.current.slot === slot && epoch === authenticationGeneration() && owner === getCurrentOfflineRuntimeUserId();
  const show = (v: Omit<View, "slot" | "epoch">) => { if (active()) setView({ ...v, slot, epoch }); };
  useEffect(() => {
    mounted.current = true;
    const lock = () => { flight.current?.abort(); flight.current = null; pending.current = null; locallySent.current = ""; verifiedAbsent.current = ""; setView(null); setBusy(false); };
    lock(); setStorageFailed(false);
    try {
      pending.current = readBatchReceipt(slot);
      if (pending.current) setView({ slot, epoch, unresolved: true });
    } catch { setStorageFailed(true); }
    window.addEventListener(OFFLINE_ACCESS_LOCKED_EVENT, lock);
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, lock);
    return () => { mounted.current = false; flight.current?.abort(); window.removeEventListener(OFFLINE_ACCESS_LOCKED_EVENT, lock); window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, lock); };
  }, [slot, epoch]);

  function remember(next: BatchReceipt | null) {
    const old = pending.current;
    pending.current = next;
    try {
      if (next) sessionStorage.setItem(slot, JSON.stringify(next));
      else if (readBatchReceipt(slot)?.key === old?.key) sessionStorage.removeItem(slot);
    } catch { setStorageFailed(true); }
  }
  function accepted(task: BackgroundTaskRead) {
    remember(null); verifiedAbsent.current = ""; locallySent.current = "";
    queryClient.setQueryData<BackgroundTaskRead[]>(["active-tasks"], (list = []) => [task, ...list.filter(t => t.job_id !== task.job_id)]);
    void queryClient.invalidateQueries({queryKey:["active-tasks"]});
    show({accepted:true}); openTasks();
  }
  async function check(r: BatchReceipt, signal: AbortSignal) {
    const result = await getBatchExportRequest(r.key, signal);
    if (!active() || pending.current?.key !== r.key) return;
    if (result.found && result.task?.job_id) accepted(result.task);
    else if (result.found === false && result.task === null) {
      verifiedAbsent.current = r.key;
      show({unresolved:true,notFound:true});
    } else throw Error("Unconfirmed receipt");
  }
  async function act(ids?: string[], origin?: ProjectExportScope, originalSelection?:string[]) {
    if (flight.current || !active() || ids?.length === 0) return;
    if (ids && ids.length > BATCH_EXPORT_SELECTION_LIMIT) { show({error:"BATCH_EXPORT_LIMIT"}); return; }
    const ctrl = new AbortController(); flight.current = ctrl; setBusy(true);
    const timeout = window.setTimeout(() => ctrl.abort(), 20_000);
    let writing = false;
    try {
      const old = pending.current;
      if (!ids) { if (old) await check(old, ctrl.signal); return; }
      const digest = await batchIntentDigest(ids, origin);
      if (!active() || ctrl.signal.aborted) return;
      if (old && (old.digest !== digest || (locallySent.current !== old.key && verifiedAbsent.current !== old.key))) {
        await check(old, ctrl.signal); return; // A read never silently turns into a new POST.
      }
      const receipt = old ?? { key:`batch-export-${crypto.randomUUID()}`, digest, time:Date.now() };
      remember(receipt); locallySent.current = receipt.key; verifiedAbsent.current = "";
      setView(null); writing = true;
      const task = await queueConversationBatchExport(ids, receipt.key, ctrl.signal, origin);
      if (active() && pending.current?.key === receipt.key) accepted(task);
    } catch (err) {
      if (!active()) return;
      const code = batchExportFailureCode(err);
      if (writing && err instanceof ApiRequestError && err.status === 409 && err.code === "BATCH_EXPORT_PROJECT_CHANGED" && ids && origin) {
        const r = err.details?.review as ProjectExportReview | undefined;
        if (r && Array.isArray(r.active_ids) && Number.isInteger(r.count) && typeof r.reviewed === "string") {
          remember(null); show({change:{ids,selection:originalSelection??ids,origin,review:r}}); return;
        }
      }
      if (writing && code !== "BATCH_EXPORT_UNCONFIRMED") remember(null);
      show({error:code, unresolved:!!pending.current});
    } finally {
      window.clearTimeout(timeout);
      if (flight.current === ctrl) { flight.current = null; if (active()) setBusy(false); }
    }
  }
  const drift = view?.change;
  const staleChoice = drift?.origin.mode === "selected" && selection !== undefined &&
    (selection.length !== drift.selection.length || selection.some((id,i) => id !== drift.selection[i]));
  const v = !staleChoice && view?.slot === slot && view.epoch === epoch ? view : null, c = v?.change;
  const submit = (items: Array<{id:string} | string>, origin?:ProjectExportScope) =>
    act(items.map(item => typeof item === "string" ? item : item.id), origin);
  const feedback = !v ? null : <div role={v.error || c ? "alert" : "status"} className="flex flex-wrap items-center gap-x-3 rounded-lg border border-ui bg-surface px-3 py-2 text-sm">
    {c ? <>
      <p className="basis-full font-medium text-primary">{c.origin.mode === "whole"
        ? (zh ? `《${c.review.name}》的项目范围已变化，尚未导出。` : `The scope of “${c.review.name}” changed. Nothing was exported.`)
        : (zh ? `原选 ${c.ids.length} 条，仍是《${c.review.name}》的活动对话 ${c.review.count} 条。` : `Of ${c.ids.length} selected, ${c.review.count} are still active in “${c.review.name}”.`)}</p>
      {c.review.archived ? <span>{zh ? "此项目已归档。" : "This project is archived."}</span> : null}
      {c.review.changes && <div className="basis-full space-y-1 break-words text-secondary">
        {(["added","removed"] as const).map(kind=>{
          const diff=c.review.changes![kind];
          if(!diff.count)return null;
          const label=kind==="added"?(zh?"新增":"Added"):(zh?"不再属于此范围":"No longer in scope");
          return <p key={kind}>{label}{zh?` ${diff.count} 条`:`: ${diff.count}`}{diff.titles.length?` · ${diff.titles.join("、")}`:""}{diff.count>diff.titles.length&&diff.titles.length? " …":""}</p>;
        })}
        {c.origin.mode==="whole"&&!c.review.changes.added.count&&!c.review.changes.removed.count&&
          <p>{c.review.changes.order_changed?(zh?"成员相同，导出顺序已改变。":"Same conversations, different export order."):(zh?"成员相同，项目名称或归档状态已改变。":"Same conversations; the project name or archive state changed.")}</p>}
      </div>}
      {c.origin.mode === "selected" && (c.review.can_export_original === false
        ? <p className="basis-full text-secondary">{zh?"原选中有对话已不可访问，无法导出原清单。":"Some selected conversations are no longer accessible. The original selection cannot be exported."}</p>
        : <button className={control} disabled={busy} onClick={()=>void act(c.ids,{...c.origin,reviewed:c.review.reviewed},c.selection)}>{zh?`仍导出原选 ${c.ids.length} 条`:`Export original ${c.ids.length}`}</button>)}
      {c.review.active_ids.length > 0 && (c.origin.mode === "whole" || c.review.count < c.ids.length) && <button className={control} disabled={busy}
        onClick={()=>void act(c.review.active_ids,{...c.origin,reviewed:c.origin.mode === "whole" ? c.review.reviewed : c.review.remaining_reviewed},c.selection)}>{c.origin.mode === "whole"
          ? (zh?`导出当前项目的 ${c.review.count} 条`:`Export ${c.review.count} in this project`)
          : (zh?`仅导出仍在项目中的 ${c.review.count} 条`:`Export only the ${c.review.count} still in this project`)}</button>}
      {c.review.count > c.review.limit && <span>{zh?`单次最多 ${c.review.limit} 条，请分批勾选。`:`Select in batches of up to ${c.review.limit}.`}</span>}
    </> : <>
      <span className={v.error ? "text-[var(--danger)]" : "text-secondary"}>{v.error ? batchExportError(v.error,zh) :
        v.accepted ? (zh?"导出已加入任务，离开页面后仍会继续。":"Export queued. It continues after you leave this page.") :
        v.notFound ? (zh?"尚未查到上次任务。重选原清单可用原请求重试。":"No job found yet. Retry the same selection with the original request.") :
        (zh?"有一项导出的提交结果尚未确认。":"A previous export has no confirmed receipt.")}</span>
      {v.unresolved && <button className={control} disabled={busy} onClick={()=>void act()}>{zh?"核对上次导出":"Check previous export"}</button>}
      {v.notFound && <button className={control} disabled={busy} onClick={()=>{remember(null); setView(null);}}>{zh?"放弃上次请求":"Discard previous request"}</button>}
      <button type="button" onClick={openTasks} className={control}>{zh?"查看任务":"View tasks"}</button>
    </>}
    {!v.unresolved && <button type="button" onClick={()=>setView(null)} className="min-h-11 text-secondary">{zh?"关闭":"Dismiss"}</button>}
    {storageFailed && <small className="basis-full text-secondary">{zh?"本标签页无法保存收据；刷新前请先核对任务。":"The receipt could not be saved in this tab. Check Tasks before reloading."}</small>}
  </div>;
  return { submit, feedback, busy, needsReview:!!c, overLimit:(n:number)=>n>BATCH_EXPORT_SELECTION_LIMIT };
}
