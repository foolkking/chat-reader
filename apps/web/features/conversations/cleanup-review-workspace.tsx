"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { CleanupExceptionEditor } from "../../components/cleanup-exceptions";
import { CleanupRuleEditor } from "../../components/cleanup-rule-editor";
import { applyCleanupScan, getCleanupPreview, getCleanupReviewGroups, getCleanupReviewPage, rescanCleanup, updateCleanupDecisions, updateCleanupFilter } from "../../lib/api";
import { cleanupRuleLabel } from "../../lib/content-cleanup";
import type { CleanupOccurrenceRead, CleanupReviewFilter, CleanupScanRead } from "../../lib/types";

export function CleanupReviewWorkspace({ scan, conversationId, onLocate, onApplied, onClose, onRescan, onDirtyChange }: {
  scan: CleanupScanRead; conversationId?: string;
  onLocate?: (item: CleanupOccurrenceRead) => Promise<void> | void;
  onApplied?: () => Promise<void> | void; onClose?: () => void; onRescan: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const [filter, setFilter] = useState<CleanupReviewFilter>({});
  const [offset, setOffset] = useState(0);
  const [groupOffset, setGroupOffset] = useState(0);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [intent, setIntent] = useState<{ kind: "ignore" | "learn"; item: CleanupOccurrenceRead } | null>(null);
  const [pendingDecisions, setPendingDecisions] = useState<Record<string, "KEEP" | "DELETE">>({});
  const groupRef = useRef<HTMLDivElement>(null);
  const groupScroll = useRef(0);
  const groups = useQuery({ queryKey: ["cleanup-review", scan.id, "groups", groupOffset], queryFn: () => getCleanupReviewGroups(scan.id, groupOffset) });
  const page = useQuery({ queryKey: ["cleanup-review", scan.id, "page", filter, offset], queryFn: () => getCleanupReviewPage(scan.id, filter, offset), enabled: !previewing });
  const preview = useQuery({ queryKey: ["cleanup-review", scan.id, "preview", previewOffset], queryFn: () => getCleanupPreview(scan.id, previewOffset), enabled: previewing, staleTime: 0 });
  const ruleGroups = useMemo(() => {
    const result = new Map<string, NonNullable<typeof groups.data>["items"]>();
    for (const item of groups.data?.items ?? []) result.set(item.rule_id, [...(result.get(item.rule_id) ?? []), item]);
    return [...result.entries()];
  }, [groups.data]);
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["cleanup-review", scan.id] }), client.invalidateQueries({ queryKey: ["content-cleanup-scan", scan.id] }), client.invalidateQueries({ queryKey: ["content-cleanup-pending"] })]);
  };
  const decisions = useMutation({ onMutate: (input: { item?: CleanupOccurrenceRead; decision: "KEEP" | "DELETE" }) => {
    setFeedback("");
    if (input.item) setPendingDecisions((previous) => ({ ...previous, [input.item!.id]: input.decision }));
  }, mutationFn: async (input: { item?: CleanupOccurrenceRead; decision: "KEEP" | "DELETE" }) => {
    if (input.item) await updateCleanupDecisions(scan.id, [{ occurrence_id: input.item.id, decision: input.decision }]);
    else await updateCleanupFilter(scan.id, filter, input.decision);
  }, onSuccess: async () => { await refresh(); setFeedback(zh ? "选择已保存，关闭后可继续审查。" : "Selection saved. You can close and resume this review."); }, onSettled: (_result, _error, input) => {
    if (input.item) setPendingDecisions((previous) => { const next = { ...previous }; delete next[input.item!.id]; return next; });
  } });
  const rescan = useMutation({ mutationFn: () => rescanCleanup(scan.id), onSuccess: (next) => onRescan(next.id) });
  const apply = useMutation({ mutationFn: () => applyCleanupScan(scan.id, preview.data!.preview_token), onSuccess: async (result) => {
    await onApplied?.();
    await Promise.all(["reader-turn-window", "conversation", "conversation-index", "toc", "conversations", "content-cleanup-pending"].map((key) => client.invalidateQueries({ queryKey: [key] })));
    if (!result.conflicts) onClose?.();
    else { setPreviewing(false); setFeedback(zh ? `已处理 ${result.applied} 项；${result.conflicts} 项发生冲突，原文已保留。` : `${result.applied} applied; ${result.conflicts} conflicts kept unchanged.`); await refresh(); }
  } });
  const selectGroup = (next: CleanupReviewFilter) => {
    groupScroll.current = groupRef.current?.scrollTop ?? 0;
    setFilter({ ...next, selected_only: filter.selected_only });
    setOffset(0); setMobileDetail(true);
  };
  const error = decisions.error ?? rescan.error ?? apply.error;
  const selectedCount = scan.delete_count;
  const pending = decisions.isPending || apply.isPending || rescan.isPending;
  if (intent?.kind === "ignore") return <CleanupExceptionEditor scanId={scan.id} occurrenceId={intent.item.id} onDone={(saved) => { setIntent(null); if (saved) { void refresh(); setFeedback(zh ? "个人例外已保存，本次候选保留。" : "Personal exception saved; this candidate is kept."); } }} />;
  if (intent?.kind === "learn") return <CleanupRuleEditor initialText={intent.item.match_text} initialRole={intent.item.role} conversationId={intent.item.conversation_id} onDirtyChange={onDirtyChange} onDone={(saved) => { setIntent(null); onDirtyChange?.(false); if (saved) setFeedback(zh ? "个人规则已保存，后续扫描会使用此规则，正文保持不变。" : "Personal rule saved for future scans. Content is unchanged."); }} />;
  return <div className="space-y-3">
    <p className="text-xs leading-5 text-secondary">{zh ? "默认全部保留。选择需删除的片段后，先预览完整差异，再确认应用。代码、公式和引用等保护区只能在源码中编辑。" : "Everything is kept by default. Select fragments, preview complete changes, then confirm. Protected code, math and references require source editing."}</p>
    {previewing ? <section aria-label={zh ? "清理差异预览" : "Cleanup change preview"} className="space-y-3">
      <button type="button" disabled={apply.isPending} className="btn-secondary min-h-11 px-3 text-sm" onClick={() => setPreviewing(false)}>{zh ? "返回选择" : "Back to selection"}</button>
      {preview.isLoading ? <p role="status">{zh ? "正在生成完整差异…" : "Preparing complete changes…"}</p> : null}
      {preview.isError ? <Retry error={preview.error} onRetry={() => void preview.refetch()} zh={zh} /> : null}
      {preview.data ? <>
        <p className="text-sm font-medium text-primary">{zh ? `${preview.data.summary.conversations} 个对话 · ${preview.data.summary.messages} 条消息 · ${preview.data.summary.fragments} 个删除片段` : `${preview.data.summary.conversations} conversations · ${preview.data.summary.messages} messages · ${preview.data.summary.fragments} fragments`}</p>
        {preview.data.items.map((item) => <article key={item.message_id} className="space-y-2 border-t border-ui py-3"><h3 className="text-sm font-medium text-primary">{item.conversation_title} · {item.role}</h3>{item.conflict ? <p role="alert" className="text-xs text-[var(--danger)]">{zh ? "源版本变化或删除不安全；此消息会保留原文，请重新扫描。" : "Source changed or removal is unsafe. This message stays unchanged; rescan it."}</p> : null}<div className="grid gap-3 md:grid-cols-2"><div><h4 className="mb-1 text-xs font-semibold text-secondary">{zh ? "修改前（完整正文）" : "Before (complete text)"}</h4><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ui bg-subtle p-3 text-xs leading-5">{item.before}</pre></div><div><h4 className="mb-1 text-xs font-semibold text-secondary">{zh ? "修改后（完整正文）" : "After (complete text)"}</h4><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-ui bg-subtle p-3 text-xs leading-5">{item.after}</pre></div></div></article>)}
        <Pagination total={preview.data.summary.messages} offset={previewOffset} limit={10} onChange={setPreviewOffset} disabled={apply.isPending} zh={zh} />
        <div className="sticky bottom-0 border-t border-ui bg-page py-3"><button type="button" disabled={apply.isPending || preview.isFetching || !preview.data.summary.fragments} onClick={() => apply.mutate()} className="btn-secondary min-h-11 px-4 text-sm font-semibold">{apply.isPending ? (zh ? "正在应用…" : "Applying…") : (zh ? `确认应用 ${preview.data.summary.fragments} 项清理` : `Confirm ${preview.data.summary.fragments} removals`)}</button><p className="mt-2 text-xs text-secondary">{zh ? "将创建正常消息新版本；已完成的部分不会重复处理。" : "This creates normal message versions. Completed changes are not applied twice."}</p></div>
      </> : null}
    </section> : <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ui pb-3"><span className="text-sm font-medium">{scan.occurrence_count} {zh ? "个候选" : "candidates"}</span><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(filter.selected_only)} disabled={pending} onChange={(event) => { setFilter({ ...filter, selected_only: event.target.checked }); setOffset(0); }} />{zh ? "只看已选项" : "Selected only"}</label></div>
      <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div ref={groupRef} onScroll={(event) => { groupScroll.current = event.currentTarget.scrollTop; }} className={`${mobileDetail ? "hidden lg:block" : "block"} max-h-[55dvh] space-y-2 overflow-auto rounded-lg border border-ui p-2`} aria-label={zh ? "按规则和对话分组" : "Groups by rule and conversation"}>
          <button type="button" className="btn-secondary min-h-11 w-full px-3 text-left text-sm" aria-pressed={!filter.rule_id && !filter.conversation_id} onClick={() => selectGroup({})}>{zh ? "全部候选" : "All candidates"}</button>
          {groups.isLoading ? <p role="status" className="text-xs">{zh ? "正在读取分组…" : "Loading groups…"}</p> : null}
          {groups.isError ? <Retry error={groups.error} onRetry={() => void groups.refetch()} zh={zh} /> : null}
          {ruleGroups.map(([ruleId, items]) => <div key={ruleId} className="border-t border-ui pt-2"><button type="button" aria-pressed={filter.rule_id === ruleId && !filter.conversation_id} className="min-h-11 w-full rounded-md px-2 text-left text-xs font-semibold text-accent hover:bg-subtle" onClick={() => selectGroup({ rule_id: ruleId })}>{cleanupRuleLabel(items[0].rule_name, items[0].detector_id, zh)}</button>{items.map((item) => <button type="button" key={item.conversation_id} aria-pressed={filter.rule_id === ruleId && filter.conversation_id === item.conversation_id} onClick={() => selectGroup({ rule_id: ruleId, conversation_id: item.conversation_id })} className="min-h-11 w-full rounded-md px-2 py-2 text-left text-xs text-primary hover:bg-subtle aria-pressed:bg-subtle"><span className="block break-words">{item.conversation_title}</span><span className="mt-1 block text-secondary">{item.count} {zh ? "项命中 · 已选" : "matches · selected"} {item.selected}</span></button>)}</div>)}
          {groups.data ? <Pagination total={groups.data.total} offset={groupOffset} limit={100} onChange={setGroupOffset} disabled={pending} zh={zh} /> : null}
        </div>
        <div className={`${mobileDetail ? "block" : "hidden lg:block"} min-w-0 space-y-3`}>
          <button type="button" className="btn-secondary min-h-11 px-3 text-xs lg:hidden" onClick={() => { setMobileDetail(false); requestAnimationFrame(() => { if (groupRef.current) groupRef.current.scrollTop = groupScroll.current; }); }}>{zh ? "返回分组" : "Back to groups"}</button>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={pending || !page.data?.total} onClick={() => decisions.mutate({ decision: "DELETE" })} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "选择全部匹配项" : "Select all matching"}</button><button type="button" disabled={pending || !page.data?.total} onClick={() => decisions.mutate({ decision: "KEEP" })} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "保留全部匹配项" : "Keep all matching"}</button></div>
          <p className="text-xs text-secondary">{zh ? "批量选择覆盖当前筛选范围的所有分页，保护区与冲突项除外。" : "Bulk selection covers every page in this filter, excluding protected content and conflicts."}</p>
          {page.isLoading ? <p role="status">{zh ? "正在读取候选…" : "Loading candidates…"}</p> : null}
          {page.isError ? <Retry error={page.error} onRetry={() => void page.refetch()} zh={zh} /> : null}
          {page.data?.total === 0 ? <p className="py-5 text-sm text-secondary">{zh ? "当前筛选没有候选，正文保持不变。" : "No candidates in this filter. Content remains unchanged."}</p> : null}
          <div className="divide-y divide-[var(--border)]">{page.data?.items.map((item) => {
            const protectedItem = item.decision === "PROTECTED" || item.evidence_codes?.includes("PROTECTED_RANGE");
            const disabled = pending || item.stale || protectedItem || item.decision === "CONFLICT" || item.decision === "APPLIED";
            return <article key={item.id} className="space-y-2 py-3"><label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1 shrink-0" checked={(pendingDecisions[item.id] ?? item.decision) === "DELETE" && !protectedItem} disabled={Boolean(disabled)} onChange={(event) => decisions.mutate({ item, decision: event.target.checked ? "DELETE" : "KEEP" })} aria-label={`${zh ? "处理" : "Process"} ${item.match_text}`} /><span className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6"><span className="text-secondary">{item.context_before}</span><mark data-testid="content-cleanup-match" className="bg-[var(--warning-soft)] font-medium text-primary">{item.match_text}</mark><span className="text-secondary">{item.context_after}</span></span></label><p className="text-xs text-secondary">{item.conversation_title} · {item.role} · {zh ? "行" : "Line"} {item.line_start} · {reason(item, zh)}</p>{protectedItem ? <p className="text-xs text-[var(--warning)]">{zh ? "保护区：请返回源码编辑。" : "Protected content: edit the source instead."}</p> : null}{item.stale || item.decision === "CONFLICT" ? <p className="text-xs text-[var(--danger)]">{zh ? "版本变化或无法安全处理；原文已保留，请重新扫描。" : "Version changed or removal is unsafe. Source retained; rescan to continue."}</p> : null}{item.decision === "APPLIED" ? <p className="text-xs text-secondary">{zh ? "已完成，不会重复处理。" : "Completed; will not be applied again."}</p> : null}{item.decision === "DELETE" ? <p className="whitespace-pre-wrap break-words rounded-md bg-subtle p-2 text-xs leading-5 text-secondary"><span className="font-semibold">{zh ? "删除后上下文：" : "Context after removal: "}</span>{item.context_before}{item.context_after}</p> : null}{!item.stale && !["CONFLICT", "APPLIED"].includes(item.decision) ? <div className="flex flex-wrap gap-2">{item.detector_id !== "manual-selection-v1" && item.match_text.length <= 4096 ? <button type="button" disabled={pending} onClick={() => setIntent({ kind: "ignore", item })} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "以后忽略这种情况" : "Ignore this case in future"}</button> : null}{!protectedItem && item.match_text.length <= 500 ? <button type="button" disabled={pending} onClick={() => setIntent({ kind: "learn", item })} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "记住此类噪声" : "Remember this noise"}</button> : null}</div> : null}{onLocate && item.conversation_id === conversationId ? <button type="button" onClick={() => void onLocate(item)} className="min-h-11 text-xs font-medium text-accent underline">{zh ? "在正文中查看" : "Locate in reader"}</button> : null}</article>;
          })}</div>
          {page.data ? <Pagination total={page.data.total} offset={offset} limit={50} onChange={setOffset} disabled={pending} zh={zh} /> : null}
        </div>
      </div>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-ui bg-page py-3"><span role="status" className="text-sm font-medium">{zh ? `已选 ${selectedCount} 项` : `${selectedCount} selected`}</span><div className="flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => rescan.mutate()} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "重新扫描原对话" : "Rescan conversations"}</button><button type="button" disabled={pending || !selectedCount} onClick={() => { setPreviewOffset(0); setPreviewing(true); }} className="btn-secondary min-h-11 px-3 text-sm font-semibold">{zh ? `预览 ${selectedCount} 项清理` : `Preview ${selectedCount} removals`}</button></div></div>
    </>}
    {pending ? <p role="status" className="text-xs text-secondary">{zh ? "正在保存或处理，请稍候…" : "Saving or processing…"}</p> : null}
    {feedback ? <p role="status" className="text-xs text-secondary">{feedback}</p> : null}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error.message}</p> : null}
  </div>;
}

function Pagination({ total, offset, limit, onChange, disabled, zh }: { total: number; offset: number; limit: number; onChange: (offset: number) => void; disabled: boolean; zh: boolean }) {
  if (total <= limit) return null;
  return <nav aria-label={zh ? "审查分页" : "Review pages"} className="flex flex-wrap items-center justify-between gap-1 border-t border-ui pt-2 text-xs"><button type="button" className="btn-secondary min-h-11 px-2" disabled={disabled || offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>{zh ? "上一页" : "Previous"}</button><span>{Math.floor(offset / limit) + 1} / {Math.ceil(total / limit)}</span><button type="button" className="btn-secondary min-h-11 px-2" disabled={disabled || offset + limit >= total} onClick={() => onChange(offset + limit)}>{zh ? "下一页" : "Next"}</button></nav>;
}

function Retry({ error, onRetry, zh }: { error: Error; onRetry: () => void; zh: boolean }) {
  return <div role="alert"><p className="text-xs text-[var(--danger)]">{error.message}</p><button type="button" onClick={onRetry} className="btn-secondary mt-2 min-h-11 px-3 text-xs">{zh ? "重试" : "Retry"}</button></div>;
}

function reason(item: CleanupOccurrenceRead, zh: boolean): string {
  const labels: Record<string, [string, string]> = {
    PRIVATE_CITATION: ["完整协议引用标记", "Complete protocol citation"], PRIVATE_CITATION_BROKEN: ["残缺协议标记", "Damaged protocol marker"],
    PRIVATE_CITATION_FRAGMENT: ["残缺私有标记建议", "Possible private marker fragment"], PRIVATE_MARKER: ["未知私有标记，需确认", "Unknown private marker; confirmation needed"],
    THINKING_SUMMARY: ["导出的思考摘要", "Exported thinking summary"], EXPORTER_FOOTER: ["导出器页脚", "Exporter footer"],
    VISIBLE_CITATION: ["完整可见引用协议", "Visible citation protocol"],
    PARTIAL_SELECTION: ["选区已扩展至完整标记", "Selection expanded to the complete marker"], MANUAL_SELECTION: ["手动选区", "Manual selection"],
  };
  return labels[item.reason_code]?.[zh ? 0 : 1] ?? (item.match_mode === "BOUNDED_FUZZY" ? (zh ? "近似匹配建议" : "Approximate match suggestion") : (zh ? "规则匹配，需确认" : "Rule match; confirmation needed"));
}
