"use client";
import { useEffect, useRef, useState } from "react";
import { usePreferences } from "./preferences-provider";
import { useInteractionDialog } from "./interaction-dialog-provider";
import { supportButtonClass, supportInputClass } from "./support-request-form";
import { SupportError, supportErrorText, supportFetch, type SupportFlight, type SupportLimitState } from "../lib/support-client";

export function SupportLimitEditor({ userId, onChanged, onDirtyChange }: { userId: string; onChanged: () => void; onDirtyChange?: (value: boolean) => void }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN", { confirm } = useInteractionDialog();
  const [open, setOpen] = useState(false), [state, setState] = useState<SupportLimitState | null>(null), [error, setError] = useState<unknown>(null);
  const [importLimit, setImportLimit] = useState(""), [mergeLimit, setMergeLimit] = useState(""), [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const flight = useRef<SupportFlight | null>(null);
  const path = `/api/admin/users/${encodeURIComponent(userId)}/limit-overrides`;
  const dirty = Boolean(state && (reason || importLimit !== String(state.approved.import_size_mb ?? "") || mergeLimit !== String(state.approved.merge_message_count ?? ""))) || uncertain;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const load = async () => {
    setBusy(true); setError(null);
    try { const result = await supportFetch<SupportLimitState>(path); setState(result); setImportLimit(String(result.approved.import_size_mb ?? "")); setMergeLimit(String(result.approved.merge_message_count ?? "")); setReason(""); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!state || busy) return;
    if (!flight.current && !(await confirm({ title: zh ? "更新此账户限制？" : "Update this account's limits?", description: zh ? "留空的项目会恢复系统默认值。保存后立即生效，历史申请记录不变。" : "Blank fields use the system default. Changes take effect immediately; request history stays intact.", confirmLabel: zh ? "保存限制" : "Save limits" }))) return;
    setBusy(true); setError(null);
    flight.current ??= { path, method: "PUT", key: crypto.randomUUID(), payload: { base_revision: state.revision, limits: { import_size_mb: importLimit ? Number(importLimit) : null, merge_message_count: mergeLimit ? Number(mergeLimit) : null }, reason } };
    setUncertain(true);
    try { const result = await supportFetch<SupportLimitState>(path, flight.current); setState(result); setImportLimit(String(result.approved.import_size_mb ?? "")); setMergeLimit(String(result.approved.merge_message_count ?? "")); setReason(""); flight.current = null; setUncertain(false); onChanged(); }
    catch (e) { setError(e); if (e instanceof SupportError && e.status >= 400 && e.status < 500 && e.status !== 401) { flight.current = null; setUncertain(false); } }
    finally { setBusy(false); }
  };
  const invalid = [importLimit, mergeLimit].some(v => v && !Number.isSafeInteger(Number(v))) || Boolean(importLimit && (Number(importLimit) < 1 || Number(importLimit) > (state?.hard_bounds.import_size_mb ?? 0))) || Boolean(mergeLimit && (Number(mergeLimit) < 2 || Number(mergeLimit) > (state?.hard_bounds.merge_message_count ?? 0)));
  return <details className="border-t border-ui" open={open} onToggle={e => { const next = e.currentTarget.open; setOpen(next); if (next && !state && !busy) void load(); }}><summary className="min-h-11 cursor-pointer py-3 text-sm text-secondary">{zh ? "账户限额调整" : "Account limit adjustment"}</summary><div className="space-y-3 pb-3">
    {state ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save(); }}><p className="text-xs text-secondary">{zh ? "仅作用于此账户。留空恢复系统默认。" : "Applies only to this account. Leave blank to use the system default."}</p><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">{zh ? "单文件导入（MiB）" : "Import per file (MiB)"}<input type="number" step={1} min={1} max={state.hard_bounds.import_size_mb ?? undefined} disabled={busy || uncertain} className={supportInputClass} value={importLimit} onChange={e => setImportLimit(e.target.value)} /></label><label className="text-sm">{zh ? "合并消息数" : "Merged messages"}<input type="number" step={1} min={2} max={state.hard_bounds.merge_message_count ?? undefined} disabled={busy || uncertain} className={supportInputClass} value={mergeLimit} onChange={e => setMergeLimit(e.target.value)} /></label></div><label className="block text-sm">{zh ? "调整原因" : "Reason"}<textarea required maxLength={2000} disabled={busy || uncertain} className={supportInputClass} value={reason} onChange={e => setReason(e.target.value)} /></label><button type="submit" className={supportButtonClass} disabled={busy || (!uncertain && (!dirty || !reason.trim() || invalid))}>{uncertain ? (zh ? "重试同一次保存" : "Retry this save") : (zh ? "保存限制" : "Save limits")}</button></form> : null}
    {busy ? <p role="status" className="text-sm text-secondary">{zh ? "处理中…" : "Working…"}</p> : null}
    {error ? <div role="alert" className="space-y-2 text-sm"><p>{supportErrorText(error, zh)}</p>{!uncertain ? <button type="button" className={supportButtonClass} onClick={() => { void (async () => { if (dirty && !(await confirm({ title: zh ? "重新读取限制？" : "Reload limits?", description: zh ? "当前尚未保存的调整会被替换。" : "This replaces the unsaved limit adjustment.", confirmLabel: zh ? "重新读取" : "Reload" }))) return; await load(); })(); }}>{zh ? "重新读取" : "Reload"}</button> : null}</div> : null}
  </div></details>;
}
