"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "../../components/preferences-provider";
import { CleanupExceptionEditor } from "../../components/cleanup-exceptions";
import { CleanupRuleEditor } from "../../components/cleanup-rule-editor";
import { ApiRequestError, applyCleanupScan, getCleanupOutcome, getCleanupPreview, getCleanupReviewGroups, getCleanupReviewPage, getCleanupScan, updateCleanupDecisions, updateCleanupFilter } from "../../lib/api";
import { authenticationGeneration } from "../../lib/offline-access";
import { cleanupRuleLabel } from "../../lib/content-cleanup";
import type { CleanupApplyResult, CleanupOccurrenceRead, CleanupOutcome, CleanupReviewFilter, CleanupScanRead } from "../../lib/types";
import { CleanupCompletion } from "./cleanup-completion";
import { CleanupCandidate } from "./cleanup-candidate";
import { CleanupChangePreview } from "./cleanup-change-preview";
import { CleanupRescanButton, CleanupRescanControls, CleanupRescanFeedback, type useCleanupRescan } from "./use-cleanup-rescan";

export function CleanupReviewWorkspace({ scan, conversationId, onLocate, onApplied, onClose, rescan, onDirtyChange, onResultChange }: {
  scan: CleanupScanRead; conversationId?: string;
  onLocate?: (item: CleanupOccurrenceRead) => Promise<void> | void;
  onApplied?: (signal?: AbortSignal) => Promise<void> | void; onClose?: () => void; rescan: ReturnType<typeof useCleanupRescan>;
  onDirtyChange?: (dirty: boolean) => void;
  onResultChange?: (hasResult: boolean) => void;
}) {
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const client = useQueryClient();
  const [filter, setFilter] = useState<CleanupReviewFilter>({});
  const [offset, setOffset] = useState(0);
  const [groupOffset, setGroupOffset] = useState(0);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [scopeLabel, setScopeLabel] = useState<{ title?: string; rule?: { name: string; detector: string | null } }>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const previewBackRef = useRef<HTMLButtonElement>(null);
  const reviewScroll = useRef(0);
  const returningToReview = useRef(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewOffset, setPreviewOffset] = useState(0);
  const [previewBlocked, setPreviewBlocked] = useState(false);
  const [confirmed, setConfirmed] = useState<CleanupApplyResult | null>(null);
  useEffect(() => { onResultChange?.(Boolean(confirmed)); }, [confirmed, onResultChange]);
  const [checkedOutcome, setCheckedOutcome] = useState<CleanupOutcome | null>(null);
  const sourceRead = useRef<AbortController | null>(null);
  const [feedback, setFeedback] = useState("");
  const [intent, setIntent] = useState<{ kind: "ignore" | "learn"; item: CleanupOccurrenceRead } | null>(null);
  const intentTrigger = useRef<HTMLElement | null>(null);
  const intentScroll = useRef(0);
  const intentReturning = useRef(false);
  const [pendingDecisions, setPendingDecisions] = useState<Record<string, "KEEP" | "DELETE">>({});
  const [selectionUnconfirmed, setSelectionUnconfirmed] = useState(false);
  const selectionRequest = useRef<AbortController | null>(null);
  const selectionRecoveryRef = useRef<HTMLButtonElement>(null);
  const restoreSelectionFocus = useRef(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const restoreItemFocus = useRef(false);
  const groupTrigger = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  const generation = useRef(authenticationGeneration());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sourceRead.current?.abort(); selectionRequest.current?.abort(); }; }, []);
  const active = () => mounted.current && generation.current === authenticationGeneration();
  const groupScroll = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => { setGroupQuery(groupSearch.trim()); setGroupOffset(0); }, 250);
    return () => clearTimeout(timer);
  }, [groupSearch]);
  const groups = useQuery({ queryKey: ["cleanup-review", scan.id, "groups", groupQuery, groupOffset], queryFn: ({ signal }) => getCleanupReviewGroups(scan.id, groupOffset, signal, groupQuery), enabled: !selectionUnconfirmed, staleTime: 0, retry: false });
  const page = useQuery({ queryKey: ["cleanup-review", scan.id, "page", filter, offset], queryFn: ({ signal }) => getCleanupReviewPage(scan.id, filter, offset, signal), enabled: !previewing && !intent && !selectionUnconfirmed, staleTime: 0, retry: false });
  const preview = useQuery({ queryKey: ["cleanup-review", scan.id, "preview", previewOffset], queryFn: ({ signal }) => getCleanupPreview(scan.id, previewOffset, signal), enabled: previewing, staleTime: 0, retry: false });
  useEffect(() => {
    if (!previewing) return;
    rootRef.current?.closest<HTMLElement>('[data-testid="content-cleanup-scroll"]')?.scrollTo({ top: 0 });
    previewBackRef.current?.focus({ preventScroll: true });
  }, [previewing]);
  useEffect(() => {
    const scroll = rootRef.current?.closest<HTMLElement>('[data-testid="content-cleanup-scroll"]');
    if (!previewing && returningToReview.current && !page.isFetching) {
      returningToReview.current = false;
      scroll?.scrollTo({ top: reviewScroll.current });
      previewButtonRef.current?.focus({ preventScroll: true });
    }
  }, [previewing, page.isFetching]);
  const lastOffset = Math.max(0, Math.ceil((page.data?.total ?? 0) / 50) - 1) * 50;
  useEffect(() => {
    if (intent || !intentReturning.current || page.isFetching) return;
    intentReturning.current = false;
    rootRef.current?.closest<HTMLElement>('[data-testid="content-cleanup-scroll"]')?.scrollTo({ top: intentScroll.current });
    const target = intentTrigger.current;
    if (target?.isConnected && !target.matches(":disabled")) target.focus({ preventScroll: true });
    else detailRef.current?.focus({ preventScroll: true });
  }, [intent, page.isFetching]);
  useEffect(() => {
    if (!page.isSuccess || page.isFetching || previewing) return;
    if (offset > lastOffset) { setOffset(lastOffset); return; }
    if (restoreItemFocus.current) {
      restoreItemFocus.current = false;
      const target = detailRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)');
      (target ?? detailRef.current)?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    }
  }, [lastOffset, offset, page.isSuccess, page.isFetching, page.dataUpdatedAt, previewing]);
  const ruleGroups = useMemo(() => {
    const result = new Map<string, NonNullable<typeof groups.data>["items"]>();
    for (const item of groups.data?.items ?? []) result.set(item.rule_id, [...(result.get(item.rule_id) ?? []), item]);
    return [...result.entries()];
  }, [groups.data]);
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["cleanup-review", scan.id] }), client.invalidateQueries({ queryKey: ["content-cleanup-scan", scan.id] }), client.invalidateQueries({ queryKey: ["content-cleanup-pending"] })]);
  };
  const decisions = useMutation({ onMutate: async (input: { item?: CleanupOccurrenceRead; decision: "KEEP" | "DELETE" }) => {
    setFeedback("");
    if (filter.selected_only && input.decision === "KEEP") restoreItemFocus.current = true;
    if (input.item) setPendingDecisions((previous) => ({ ...previous, [input.item!.id]: input.decision }));
    await Promise.all([client.cancelQueries({ queryKey: ["cleanup-review", scan.id] }), client.cancelQueries({ queryKey: ["content-cleanup-scan", scan.id] })]);
  }, mutationFn: async (input: { item?: CleanupOccurrenceRead; decision: "KEEP" | "DELETE" }) => {
    if (!active()) throw new Error("Review closed");
    const controller = new AbortController(); selectionRequest.current = controller;
    try {
      if (input.item) return await updateCleanupDecisions(scan.id, [{ occurrence_id: input.item.id, decision: input.decision }], controller.signal);
      return (await updateCleanupFilter(scan.id, filter, input.decision, controller.signal)).scan;
    } finally { if (selectionRequest.current === controller) selectionRequest.current = null; }
  }, onError: () => {
    if (active()) { setSelectionUnconfirmed(true); setFeedback(""); }
  }, onSuccess: (saved) => {
    if (generation.current !== authenticationGeneration()) return;
    client.setQueryData(["content-cleanup-scan", scan.id], saved);
    if (mounted.current) setFeedback(zh ? "选择已保存，关闭后可继续审查。" : "Selection saved. You can close and resume this review.");
    void refresh();
  }, onSettled: (_result, _error, input) => {
    if (!active()) return;
    if (_error) restoreItemFocus.current = false;
    if (input.item) setPendingDecisions((previous) => { const next = { ...previous }; delete next[input.item!.id]; return next; });
  } });
  const reloadSelection = useMutation({ mutationFn: async () => {
    const controller = new AbortController(); selectionRequest.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    try {
      await Promise.all([client.cancelQueries({ queryKey: ["cleanup-review", scan.id] }), client.cancelQueries({ queryKey: ["content-cleanup-scan", scan.id] })]);
      if (!active()) throw new Error("Review closed");
      const [saved, candidates, savedGroups] = await Promise.all([
        getCleanupScan(scan.id, signal), getCleanupReviewPage(scan.id, filter, offset, signal), getCleanupReviewGroups(scan.id, groupOffset, signal, groupQuery),
      ]);
      const nextOffset = Math.min(offset, Math.max(0, Math.ceil(candidates.total / 50) - 1) * 50);
      const nextCandidates = nextOffset === offset ? candidates : await getCleanupReviewPage(scan.id, filter, nextOffset, signal);
      return { saved, candidates: nextCandidates, savedGroups, nextOffset, readFilter: filter, readGroupQuery: groupQuery, readGroupOffset: groupOffset };
    } finally { controller.abort(); if (selectionRequest.current === controller) selectionRequest.current = null; }
  }, onSuccess: ({ saved, candidates, savedGroups, nextOffset, readFilter, readGroupQuery, readGroupOffset }) => {
    if (!active()) return;
    restoreSelectionFocus.current = document.activeElement === selectionRecoveryRef.current || document.activeElement === document.body;
    client.setQueryData(["content-cleanup-scan", scan.id], saved);
    client.setQueryData(["cleanup-review", scan.id, "page", readFilter, nextOffset], candidates);
    client.setQueryData(["cleanup-review", scan.id, "groups", readGroupQuery, readGroupOffset], savedGroups);
    setOffset(nextOffset); setSelectionUnconfirmed(false); decisions.reset();
    setFeedback(zh ? "已读取服务器上的选择，请核对后继续。" : "Saved choices loaded. Review them before continuing.");
    void client.invalidateQueries({ queryKey: ["content-cleanup-pending"] });
  } });
  useEffect(() => {
    if (!restoreSelectionFocus.current || selectionUnconfirmed || reloadSelection.isPending || page.isFetching) return;
    restoreSelectionFocus.current = false;
    const container = detailRef.current?.offsetParent ? detailRef.current : groupRef.current;
    const target = container?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)');
    (target ?? container)?.focus({ preventScroll: true });
  }, [selectionUnconfirmed, reloadSelection.isPending, page.isFetching]);
  const refreshReaders = () => {
    if (generation.current !== authenticationGeneration()) return;
    void Promise.all(["reader-turn-window", "conversation", "conversation-index", "toc", "conversations", "content-cleanup-pending", "active-tasks"].map((key) => client.invalidateQueries({ queryKey: [key] })));
  };
  const finish = useMutation({ mutationFn: async (_result: CleanupApplyResult) => {
    sourceRead.current?.abort();
    const controller = new AbortController(); sourceRead.current = controller;
    try { await onApplied?.(AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])); }
    finally { if (sourceRead.current === controller) sourceRead.current = null; }
  }, onSuccess: (_unused, result) => {
    if (!active()) return;
    if (!result.conflicts) onClose?.();
    else {
      setConfirmed(null); setPreviewing(false);
      setFeedback(zh ? `已处理 ${result.applied} 项；${result.conflicts} 项发生冲突，原文已保留。` : `${result.applied} applied; ${result.conflicts} conflicts kept unchanged.`);
      void refresh();
    }
  } });
  const apply = useMutation({ mutationFn: () => applyCleanupScan(scan.id, preview.data!.preview_token), onError: () => { if (active()) setPreviewBlocked(true); }, onSuccess: (result) => {
    refreshReaders();
    if (!active()) return;
    setConfirmed(result);
    finish.mutate(result);
  } });
  const checkResult = useMutation({ mutationFn: () => getCleanupOutcome(scan.id), onSuccess: (result) => {
    if (!active()) return;
    setCheckedOutcome(result);
    if (result.status === "COMPLETED") { setConfirmed(result); refreshReaders(); }
    else if (result.status === "REVIEW") void refresh();
  } });
  const selectGroup = (next: CleanupReviewFilter, label: typeof scopeLabel = {}) => {
    if (groupRef.current?.contains(document.activeElement)) groupTrigger.current = document.activeElement as HTMLElement | null;
    groupScroll.current = groupRef.current?.scrollTop ?? 0;
    setScopeLabel(label);
    setFilter({ ...next, selected_only: next.selected_only ?? filter.selected_only });
    setOffset(0); setMobileDetail(true);
    requestAnimationFrame(() => detailRef.current?.focus({ preventScroll: true }));
  };
  const error = selectionUnconfirmed ? null : decisions.error ?? apply.error;
  const selectedCount = scan.delete_count;
  const writing = decisions.isPending || reloadSelection.isPending || apply.isPending || checkResult.isPending;
  const pending = writing || selectionUnconfirmed || rescan.blocking;
  const listBusy = pending || page.isFetching || page.isError;
  const groupsBusy = pending || groups.isFetching || groups.isError || groupSearch.trim() !== groupQuery;
  const selectionSummary = !listBusy ? page.data?.selection_summary : undefined;
  const scopedSelection = Boolean((filter.rule_id || filter.conversation_id) && selectedCount);
  const showAllSelected = () => {
    setGroupSearch(""); setGroupQuery(""); setGroupOffset(0);
    selectGroup({ selected_only: true });
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start" }));
  };
  const refreshPreview = async () => {
    setPreviewBlocked(true);
    const result = await preview.refetch();
    if (active() && !result.isError) { setPreviewBlocked(false); apply.reset(); }
  };
  const allSelectedConflict = Boolean(preview.data && preview.data.summary.messages > 0
    && preview.data.items.length === preview.data.summary.messages && preview.data.items.every((item) => item.conflict));
  if (confirmed) return <CleanupCompletion result={confirmed} busy={finish.isPending} readFailed={finish.isError} onContinue={() => finish.mutate(confirmed)} />;
  return <div ref={rootRef} className="space-y-3" onPointerDownCapture={() => { restoreSelectionFocus.current = false; if (!intent) intentReturning.current = false; }} onKeyDownCapture={() => { restoreSelectionFocus.current = false; if (!intent) intentReturning.current = false; }} onBlurCapture={(event) => {
    if (event.relatedTarget && !detailRef.current?.contains(event.relatedTarget as Node)) restoreItemFocus.current = false;
  }}>
    {intent?.kind === "ignore" ? <CleanupExceptionEditor scanId={scan.id} occurrenceId={intent.item.id} onDone={(saved) => { intentReturning.current = true; setIntent(null); if (saved) { void refresh(); setFeedback(zh ? "个人例外已保存，本次候选保留。" : "Personal exception saved; this candidate is kept."); } }} /> : null}
    {intent?.kind === "learn" ? <CleanupRuleEditor initialText={intent.item.match_text} initialRole={intent.item.role} conversationId={intent.item.conversation_id} onDirtyChange={onDirtyChange} onDone={(saved) => { intentReturning.current = true; setIntent(null); onDirtyChange?.(false); if (saved) setFeedback(zh ? "个人规则已保存，后续扫描会使用此规则，正文保持不变。" : "Personal rule saved for future scans. Content is unchanged."); }} /> : null}
    {previewing ? <section aria-label={zh ? "清理差异预览" : "Cleanup change preview"} className="space-y-3">
      <button ref={previewBackRef} type="button" disabled={apply.isPending} className="btn-secondary min-h-11 px-3 text-sm" onClick={() => { returningToReview.current = true; setPreviewing(false); }}>{zh ? "返回选择" : "Back to selection"}</button>
      {preview.isLoading ? <p role="status">{zh ? "正在生成完整差异…" : "Preparing complete changes…"}</p> : null}
      {preview.isError || previewBlocked ? <div role="alert" className="rounded-lg border border-ui bg-subtle p-3 text-sm">
        <p>{preview.isError
          ? (preview.data
            ? (zh ? "差异刷新失败，下方是上次预览，暂时不能确认。选择仍保留。" : "Changes could not refresh. The previous preview is shown below; confirmation is paused. Your selection is kept.")
            : (zh ? "暂时无法读取差异，选择仍保留。请重试。" : "Changes could not load. Your selection is kept. Please retry."))
          : (zh ? "本次应用未得到完成确认。请刷新差异，核对剩余选择与源版本后再确认。" : "Completion was not confirmed. Refresh changes and review remaining selections and source versions before confirming.")}</p>
        <button type="button" disabled={preview.isFetching} className="btn-secondary mt-2 min-h-11 px-3 text-xs" onClick={() => void refreshPreview()}>{zh ? "刷新差异" : "Refresh changes"}</button>
        {apply.isError ? <button type="button" disabled={checkResult.isPending} className="btn-secondary ml-2 mt-2 min-h-11 px-3 text-xs" onClick={() => checkResult.mutate()}>{checkResult.isPending ? (zh ? "正在核对…" : "Checking…") : (zh ? "核对清理结果" : "Check cleanup result")}</button> : null}
        {checkResult.isError ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{zh ? "暂时无法确认结果，请重试核对。不会自动再次清理。" : "The result could not be confirmed. Retry the check; cleanup will not run again automatically."}</p> : null}
        {checkedOutcome && checkedOutcome.status !== "COMPLETED" ? <p role="status" className="mt-2 text-xs">{checkedOutcome.status === "APPLYING" ? (zh ? "服务器仍在清理，请稍后再核对。" : "Cleanup is still running. Check again shortly.") : (zh ? `已完成 ${checkedOutcome.applied} 项，剩余选择 ${checkedOutcome.remaining} 项，冲突 ${checkedOutcome.conflicts} 项。请刷新差异后继续。` : `${checkedOutcome.applied} completed, ${checkedOutcome.remaining} selected remaining, ${checkedOutcome.conflicts} conflicts. Refresh changes to continue.`)}</p> : null}
      </div> : null}
      {preview.data ? <>
        <p className="text-sm font-medium text-primary">{zh ? `${preview.data.summary.conversations} 个对话 · ${preview.data.summary.messages} 条消息 · ${preview.data.summary.fragments} 个已选片段` : `${preview.data.summary.conversations} conversations · ${preview.data.summary.messages} messages · ${preview.data.summary.fragments} selected fragments`}</p>
        {preview.data.items.map((item) => <CleanupChangePreview key={`${item.message_id}:${preview.data.preview_token}`} item={item} zh={zh} />)}
        {preview.data.items.some((item) => item.conflict) ? <CleanupRescanControls rescan={rescan} selectedCount={selectedCount} disabled={writing} /> : null}
        <Pagination total={preview.data.summary.messages} offset={previewOffset} limit={10} onChange={setPreviewOffset} disabled={apply.isPending} zh={zh} />
        <div className="sticky bottom-0 border-t border-ui bg-page py-3"><button type="button" disabled={pending || preview.isFetching || preview.isError || previewBlocked || allSelectedConflict || !preview.data.summary.fragments} onClick={() => apply.mutate()} className="btn-secondary min-h-11 px-4 text-sm font-semibold">{apply.isPending ? (zh ? "正在应用…" : "Applying…") : (zh ? `确认处理 ${preview.data.summary.fragments} 项选择` : `Confirm ${preview.data.summary.fragments} selections`)}</button><p className="mt-2 text-xs text-secondary">{zh ? "将创建正常消息新版本；已完成的部分不会重复处理。" : "This creates normal message versions. Completed changes are not applied twice."}</p></div>
      </> : null}
    </section> : null}
    <div hidden={previewing || Boolean(intent)} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ui pb-2"><span className="text-sm font-medium">{scan.occurrence_count} {zh ? "个候选" : "candidates"}<span className="ml-2 text-xs font-normal text-secondary">{zh ? "默认保留" : "Kept by default"}</span></span><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(filter.selected_only)} disabled={pending} onChange={(event) => { setFilter({ ...filter, selected_only: event.target.checked }); setOffset(0); }} />{zh ? "只看已选项" : "Selected only"}</label></div>
      <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div ref={groupRef} onScroll={(event) => { groupScroll.current = event.currentTarget.scrollTop; }} className={`${mobileDetail ? "hidden lg:block" : "block"} lg:sticky lg:top-0 max-h-[55dvh] space-y-2 overflow-auto rounded-lg border border-ui p-2`} aria-label={zh ? "按规则和对话分组" : "Groups by rule and conversation"}>
          <div className="flex items-center gap-1"><input ref={searchRef} type="search" aria-label={zh ? "查找对话" : "Find conversation"} placeholder={zh ? "查找对话" : "Find conversation"} value={groupSearch} maxLength={200} onChange={(event) => setGroupSearch(event.target.value)} className="min-h-11 min-w-0 w-full rounded-md border border-ui bg-surface px-2 text-sm [&::-webkit-search-cancel-button]:appearance-none" />{groupSearch ? <button type="button" aria-label={zh ? "清除搜索" : "Clear search"} className="btn-secondary min-h-11 min-w-11 px-2 text-sm" onClick={() => { setGroupSearch(""); searchRef.current?.focus(); }}>×</button> : null}</div>
          <button type="button" disabled={pending} className="btn-secondary min-h-11 w-full px-3 text-left text-sm" aria-pressed={!filter.rule_id && !filter.conversation_id} onClick={() => selectGroup({})}>{zh ? "全部候选" : "All candidates"}</button>
          {groups.isLoading ? <p role="status" className="text-xs">{zh ? "正在读取分组…" : "Loading groups…"}</p> : null}
          {groups.isError ? <Retry error={groups.error} onRetry={() => void groups.refetch()} zh={zh} /> : null}
          {groups.isSuccess && !groups.data.total ? <p role="status" className="py-2 text-xs text-secondary">{groupQuery ? (zh ? "未找到相关对话。试试其他标题。" : "No matching conversations. Try another title.") : (zh ? "暂无候选分组。" : "No candidate groups.")}</p> : null}
          {ruleGroups.map(([ruleId, items]) => {
            const rule = { name: items[0].rule_name, detector: items[0].detector_id };
            return <div key={ruleId} className="border-t border-ui pt-2"><button type="button" disabled={groupsBusy} aria-pressed={filter.rule_id === ruleId && !filter.conversation_id} className="min-h-11 w-full rounded-md px-2 text-left text-xs font-semibold text-accent hover:bg-subtle aria-pressed:bg-subtle" onClick={() => selectGroup({ rule_id: ruleId }, { rule })}>{cleanupRuleLabel(rule.name, rule.detector, zh)}</button>{items.map((item) => <button type="button" disabled={groupsBusy} key={item.conversation_id} aria-pressed={filter.rule_id === ruleId && filter.conversation_id === item.conversation_id} onClick={() => selectGroup({ rule_id: ruleId, conversation_id: item.conversation_id }, { rule, title: item.conversation_title })} className="min-h-11 w-full rounded-md px-2 py-2 text-left text-xs text-primary hover:bg-subtle aria-pressed:bg-subtle"><span className="block break-words">{item.conversation_title}</span><span className="mt-1 block text-secondary">{item.count} {zh ? "项命中 · 已选" : "matches · selected"} {item.selected}</span>
              {item.protected > 0 || item.conflicts > 0 ? <span className="mt-1 block text-secondary">{[
                item.protected > 0 ? (zh ? `${item.protected} 项受保护` : `${item.protected} protected`) : "",
                item.conflicts > 0 ? (zh ? `${item.conflicts} 项冲突` : `${item.conflicts} conflicts`) : "",
              ].filter(Boolean).join(" · ")}</span> : null}
            </button>)}</div>;
          })}
          {groups.data ? <Pagination total={groups.data.total} offset={groupOffset} limit={100} onChange={setGroupOffset} disabled={pending} zh={zh} /> : null}
        </div>
        <div ref={detailRef} tabIndex={-1} aria-label={zh ? "审查候选" : "Review candidates"} className={`${mobileDetail ? "block" : "hidden lg:block"} min-w-0 space-y-3`}>
          <button type="button" className="btn-secondary min-h-11 px-3 text-xs lg:hidden" onClick={() => { setMobileDetail(false); requestAnimationFrame(() => { if (groupRef.current) groupRef.current.scrollTop = groupScroll.current; groupTrigger.current?.focus({ preventScroll: true }); }); }}>{zh ? "返回分组" : "Back to groups"}</button>
          <section aria-label={zh ? "当前审查范围" : "Current review scope"} className="border-b border-ui pb-2">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{scopeLabel.title ?? (zh ? "本次扫描的全部对话" : "All conversations in this scan")}</h3><p className="mt-1 break-words text-xs text-secondary">{scopeLabel.rule ? cleanupRuleLabel(scopeLabel.rule.name, scopeLabel.rule.detector, zh) : (zh ? "全部规则" : "All rules")}{filter.selected_only ? (zh ? " · 只看已选项" : " · Selected only") : ""}</p></div>{filter.rule_id || filter.conversation_id ? <button type="button" disabled={pending} className="min-h-11 shrink-0 px-2 text-xs text-accent underline" onClick={() => selectGroup({})}>{zh ? "查看全部候选" : "Show all candidates"}</button> : null}</div>
            {page.data ? <p className="mt-1 text-xs text-secondary">{zh ? `此范围 ${page.data.total} 个候选` : `${page.data.total} candidates in this scope`}</p> : null}
            {selectionSummary ? <p className="mt-1 text-xs text-secondary">{zh ? `此范围已选 ${selectionSummary.selected} 项` : `${selectionSummary.selected} selected in this scope`}{selectionSummary.protected > 0 ? (zh ? ` · ${selectionSummary.protected} 项受保护` : ` · ${selectionSummary.protected} protected`) : ""}</p> : null}
            {filter.rule_id && filter.conversation_id ? <button type="button" disabled={pending} className="min-h-11 text-xs text-accent underline" onClick={() => selectGroup({ conversation_id: filter.conversation_id }, { title: scopeLabel.title })}>{zh ? "此对话的全部规则" : "All rules in this conversation"}</button> : null}
          </section>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={listBusy || !page.data?.total} onClick={() => decisions.mutate({ decision: "DELETE" })} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "选择全部匹配项" : "Select all matching"}</button><button type="button" disabled={listBusy || !page.data?.total} onClick={() => decisions.mutate({ decision: "KEEP" })} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "保留全部匹配项" : "Keep all matching"}</button></div>
          <p className="text-xs text-secondary">{zh ? "覆盖此范围全部分页；保护区与冲突项除外。" : "Covers all pages in this scope; protected content and conflicts are excluded."}</p>
          {page.isFetching ? <p role="status" className="text-xs text-secondary">{page.data ? (zh ? "正在更新候选列表…" : "Updating candidates…") : (zh ? "正在读取候选…" : "Loading candidates…")}</p> : null}
          {page.isError ? <Retry error={page.error} onRetry={() => void page.refetch()} zh={zh} message={page.data ? (zh ? "候选刷新失败，下方是上次读取结果。重试可更新选择状态。" : "Candidates could not refresh. The previous list is shown below. Retry to update the selection state.") : undefined} /> : null}
          {page.data?.total === 0 ? <p className="py-5 text-sm text-secondary">{zh ? "当前筛选没有候选，正文保持不变。" : "No candidates in this filter. Content remains unchanged."}</p> : null}
          <div className="divide-y divide-[var(--border)]">{page.data?.items.map((item) => {
            const protectedItem = item.decision === "PROTECTED" || item.evidence_codes?.includes("PROTECTED_RANGE");
            const disabled = listBusy || item.stale || protectedItem || item.decision === "CONFLICT" || item.decision === "APPLIED";
            return <CleanupCandidate key={item.id} item={item} zh={zh} reason={reason(item, zh)}
              showConversation={scan.target_count > 1}
              selected={(pendingDecisions[item.id] ?? item.decision) === "DELETE" && !protectedItem}
              disabled={Boolean(disabled)} busy={listBusy}
              onDecision={(selected) => decisions.mutate({ item, decision: selected ? "DELETE" : "KEEP" })}
              onIntent={(kind) => { intentTrigger.current = document.activeElement as HTMLElement | null; intentScroll.current = rootRef.current?.closest<HTMLElement>('[data-testid="content-cleanup-scroll"]')?.scrollTop ?? 0; setIntent({ kind, item }); }}
              onLocate={onLocate && item.conversation_id === conversationId ? () => void onLocate(item) : undefined} />;
          })}</div>
          {page.data ? <Pagination total={page.data.total} offset={offset} limit={50} onChange={(next) => { restoreItemFocus.current = true; setOffset(next); }} disabled={listBusy} zh={zh} /> : null}
        </div>
      </div>
      <div aria-label={zh ? "本次清理选择" : "Selections for this cleanup"} className="sticky bottom-0 space-y-1 border-t border-ui bg-page py-3">
        {scopedSelection && (!selectionSummary || selectionSummary.selected_elsewhere > 0) ? <div className="flex flex-wrap items-center gap-x-3 text-xs">
          <span className="text-secondary">{selectionSummary
            ? (zh ? `含其他分组的 ${selectionSummary.selected_elsewhere} 项选择` : `Includes ${selectionSummary.selected_elsewhere} selections in other groups`)
            : (zh ? "预览包含本次扫描的全部选择" : "Preview includes all selections in this scan")}</span>
          <button type="button" disabled={pending} onClick={showAllSelected} className="min-h-11 text-xs font-medium text-accent underline">{zh ? "查看全部已选项" : "View all selections"}</button>
        </div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span role="status" className="text-sm font-medium">{selectionUnconfirmed ? (zh ? "选择待核对" : "Choices need checking") : (zh ? `已选 ${selectedCount} 项` : `${selectedCount} selected`)}</span>
          <div className="flex flex-wrap items-start gap-2">
            <CleanupRescanButton rescan={rescan} selectedCount={selectedCount} disabled={writing || selectionUnconfirmed} />
            <button ref={previewButtonRef} type="button" disabled={pending || !selectedCount} onClick={() => { reviewScroll.current = rootRef.current?.closest<HTMLElement>('[data-testid="content-cleanup-scroll"]')?.scrollTop ?? 0; apply.reset(); setPreviewBlocked(false); setPreviewOffset(0); setPreviewing(true); }} className="btn-primary min-h-11 px-3 text-sm font-semibold">{zh ? `预览 ${selectedCount} 项清理` : `Preview ${selectedCount} removals`}</button>
          </div>
        </div>
        {selectionUnconfirmed ? <div className="border-l-2 border-[var(--danger)] pl-3 text-xs" role="alert">
          <p>{reloadSelection.isError
            ? (zh ? "选择读取失败，请重试。暂时不能继续修改或预览。" : "Saved choices could not load. Retry before changing or previewing selections.")
            : (zh ? "未收到保存确认。请重新读取选择后继续；不会自动重发修改。" : "Saving was not confirmed. Reload saved choices to continue; changes will not be sent again automatically.")}</p>
          <button ref={selectionRecoveryRef} type="button" disabled={reloadSelection.isPending} onClick={() => reloadSelection.mutate()} className="btn-secondary mt-2 min-h-11 px-3 text-xs">{reloadSelection.isPending ? (zh ? "正在读取选择…" : "Loading saved choices…") : (zh ? "重新读取选择" : "Reload saved choices")}</button>
        </div> : null}
        <CleanupRescanFeedback rescan={rescan} disabled={writing || selectionUnconfirmed} visible={!previewing && !intent} />
      </div>
    </div>
    {writing ? <p role="status" className="text-xs text-secondary">{zh ? "正在保存或处理，请稍候…" : "Saving or processing…"}</p> : null}
    {feedback && !previewing && !intent ? <p role="status" className="text-xs text-secondary">{feedback}</p> : null}
    {error && !(previewing && error === apply.error) ? <p role="alert" className="text-sm text-[var(--danger)]">{reviewError(error, zh)}</p> : null}
  </div>;
}

function Pagination({ total, offset, limit, onChange, disabled, zh }: { total: number; offset: number; limit: number; onChange: (offset: number) => void; disabled: boolean; zh: boolean }) {
  if (total <= limit && offset === 0) return null;
  return <nav aria-label={zh ? "审查分页" : "Review pages"} className="flex flex-wrap items-center justify-between gap-1 border-t border-ui pt-2 text-xs"><button type="button" className="btn-secondary min-h-11 px-2" disabled={disabled || offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>{zh ? "上一页" : "Previous"}</button><span>{Math.floor(offset / limit) + 1} / {Math.max(1, Math.ceil(total / limit))}</span><button type="button" className="btn-secondary min-h-11 px-2" disabled={disabled || offset + limit >= total} onClick={() => onChange(offset + limit)}>{zh ? "下一页" : "Next"}</button></nav>;
}

function Retry({ error, onRetry, zh, message }: { error: Error; onRetry: () => void; zh: boolean; message?: string }) {
  return <div role="alert"><p className="text-xs text-[var(--danger)]">{message ?? reviewError(error, zh)}</p><button type="button" onClick={onRetry} className="btn-secondary mt-2 min-h-11 px-3 text-xs">{zh ? "重试" : "Retry"}</button></div>;
}

function reviewError(error: Error, zh: boolean): string {
  if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) return zh ? "此审查已不可用，请关闭后重新打开。" : "This review is unavailable. Close it and reopen from your tasks.";
  if (error instanceof ApiRequestError && error.status === 409) return zh ? "审查或正文状态已变化，请重新读取后继续。" : "The review or source changed. Reload before continuing.";
  return zh ? "暂时无法完成请求，请检查连接后重试。" : "The request could not complete. Check your connection and retry.";
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
