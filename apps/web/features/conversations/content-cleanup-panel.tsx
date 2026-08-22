"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, ChevronLeft, ChevronRight, Eraser, Eye, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContentCleanupRuleSettings } from "../../components/content-cleanup-rule-settings";
import { usePreferences } from "../../components/preferences-provider";
import { applyCleanupScan, createCleanupScan, dismissCleanupScan, getCleanupOccurrences, getCleanupScan, getConversations, updateCleanupDecisions } from "../../lib/api";
import { cleanupRuleLabel } from "../../lib/content-cleanup";
import type { CleanupOccurrenceRead, ConversationListItem } from "../../lib/types";

type ScopeType = "CURRENT_CONVERSATION" | "SELECTED_CONVERSATIONS" | "ALL_ACTIVE";
const OCCURRENCE_PAGE_SIZE = 100;

export type CleanupSourceSelection = {
  messageId: string;
  startOffset: number;
  endOffset: number;
  text: string;
};

type ContentCleanupPanelProps = {
  conversationId?: string;
  initialScanId?: string;
  selection?: CleanupSourceSelection | null;
  onClose?: () => void;
  onLocate?: (occurrence: CleanupOccurrenceRead) => Promise<void> | void;
  onApplied?: () => Promise<void> | void;
};

export function ContentCleanupDialog(props: ContentCleanupPanelProps & { open: boolean }) {
  const { open, onClose, ...panelProps } = props;
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  useEffect(() => {
    if (!open || !onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[280] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="content-cleanup-title" data-testid="content-cleanup-dialog">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close cleanup review" />
      <div className={`relative w-full overflow-hidden rounded-t-2xl border border-ui bg-page shadow-2xl sm:max-w-4xl sm:rounded-xl ${panelProps.selection ? "max-h-[88dvh]" : "h-[min(88dvh,800px)]"}`}>
        <ContentCleanupPanel {...panelProps} onClose={onClose} />
      </div>
    </div>
  );
}

export function ContentCleanupPanel({ conversationId, initialScanId, selection, onClose, onLocate, onApplied }: ContentCleanupPanelProps) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const queryClient = useQueryClient();
  const autoStartedRef = useRef(false);
  const disposableSelectionScanRef = useRef<{ id: string | null; status: string | undefined }>({ id: initialScanId ?? null, status: undefined });
  const [view, setView] = useState<"review" | "rules">("review");
  const [scanId, setScanId] = useState<string | null>(initialScanId ?? null);
  const [page, setPage] = useState(0);
  const [decisionOverrides, setDecisionOverrides] = useState<Record<string, "DELETE" | "KEEP">>({});
  const [baselineDecisions, setBaselineDecisions] = useState<Record<string, "DELETE" | "KEEP">>({});
  const [scopeType, setScopeType] = useState<ScopeType>("CURRENT_CONVERSATION");
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>(conversationId ? [conversationId] : []);
  const candidatesQuery = useQuery({
    queryKey: ["content-cleanup-conversations"],
    queryFn: () => getConversations({ statusScope: "active", limit: 5000 }),
    enabled: !initialScanId && !selection && scopeType !== "CURRENT_CONVERSATION",
    staleTime: 30_000,
  });
  const candidates = candidatesQuery.data ?? [];
  const startMutation = useMutation({
    mutationFn: () => {
      const ids = selection
        ? (conversationId ? [conversationId] : [])
        : scopeType === "CURRENT_CONVERSATION"
          ? (conversationId ? [conversationId] : [])
          : scopeType === "ALL_ACTIVE"
            ? candidates.map((item) => item.id)
            : selectedConversationIds;
      return createCleanupScan({
        source: selection || scopeType === "CURRENT_CONVERSATION" ? "READER" : "BATCH",
        scope_type: selection ? "CURRENT_CONVERSATION" : scopeType,
        conversation_ids: ids,
        message_id: selection?.messageId,
        selection_start_offset: selection?.startOffset,
        selection_end_offset: selection?.endOffset,
      });
    },
    onSuccess: (scan) => { setPage(0); setScanId(scan.id); },
  });
  useEffect(() => {
    if (!selection || initialScanId || scanId || autoStartedRef.current) return;
    autoStartedRef.current = true;
    startMutation.mutate();
  }, [initialScanId, scanId, selection, startMutation]);

  const scanQuery = useQuery({
    queryKey: ["content-cleanup-scan", scanId],
    queryFn: () => getCleanupScan(scanId!),
    enabled: Boolean(scanId),
    refetchInterval: (query) => ["READY", "FAILED", "STALE"].includes(query.state.data?.status ?? "") ? false : 1000,
  });
  disposableSelectionScanRef.current = { id: scanId, status: scanQuery.data?.status };
  const isSelectionReview = Boolean(selection);
  useEffect(() => () => {
    if (!isSelectionReview) return;
    const current = disposableSelectionScanRef.current;
    if (current.id && ["READY", "FAILED", "STALE"].includes(current.status ?? "")) {
      void dismissCleanupScan(current.id).catch(() => undefined);
    }
  }, [isSelectionReview]);
  const occurrencesQuery = useQuery({
    queryKey: ["content-cleanup-occurrences", scanId, page],
    queryFn: () => getCleanupOccurrences(scanId!, { limit: OCCURRENCE_PAGE_SIZE, offset: page * OCCURRENCE_PAGE_SIZE }),
    enabled: Boolean(scanId && scanQuery.data?.status === "READY"),
  });
  const occurrences = occurrencesQuery.data ?? [];
  useEffect(() => {
    if (!occurrences.length) return;
    setBaselineDecisions((current) => {
      const next = { ...current };
      for (const item of occurrences) if (item.decision === "DELETE" || item.decision === "KEEP") next[item.id] = item.decision;
      return next;
    });
  }, [occurrences]);
  const groups = useMemo(() => occurrences.reduce<Record<string, CleanupOccurrenceRead[]>>((acc, item) => {
    (acc[cleanupRuleLabel(item.rule_name, item.detector_id, zh)] ??= []).push(item);
    return acc;
  }, {}), [occurrences, zh]);
  const deleteCount = useMemo(() => {
    let count = scanQuery.data?.delete_count ?? 0;
    for (const [id, decision] of Object.entries(decisionOverrides)) {
      const baseline = baselineDecisions[id];
      if (baseline === decision || !baseline) continue;
      count += decision === "DELETE" ? 1 : -1;
    }
    return Math.max(0, count);
  }, [baselineDecisions, decisionOverrides, scanQuery.data?.delete_count]);
  const decisionMutation = useMutation({
    mutationFn: async () => {
      const decisions = Object.entries(decisionOverrides).map(([occurrence_id, decision]) => ({ occurrence_id, decision }));
      if (decisions.length) await updateCleanupDecisions(scanId!, decisions);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["content-cleanup-scan", scanId] }),
  });
  const applyMutation = useMutation({
    mutationFn: async () => { await decisionMutation.mutateAsync(); return applyCleanupScan(scanId!); },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["reader-turn-window"] }),
        queryClient.invalidateQueries({ queryKey: ["conversation"] }),
        queryClient.invalidateQueries({ queryKey: ["conversation-index"] }),
        queryClient.invalidateQueries({ queryKey: ["toc"] }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      ]);
      await onApplied?.();
      if (result.conflicts === 0) onClose?.();
    },
  });
  const dismissMutation = useMutation({ mutationFn: () => dismissCleanupScan(scanId!), onSuccess: () => onClose?.() });
  const status = scanQuery.data?.status;
  const isSelected = (item: CleanupOccurrenceRead) => (decisionOverrides[item.id] ?? item.decision) === "DELETE";
  const toggle = (item: CleanupOccurrenceRead) => setDecisionOverrides((current) => ({ ...current, [item.id]: isSelected(item) ? "KEEP" : "DELETE" }));
  const selectVisible = () => setDecisionOverrides((current) => ({ ...current, ...Object.fromEntries(occurrences.filter((item) => item.decision !== "PROTECTED" && !item.stale).map((item) => [item.id, "DELETE" as const])) }));
  const pageCount = Math.max(1, Math.ceil((scanQuery.data?.occurrence_count ?? 0) / OCCURRENCE_PAGE_SIZE));

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-page" aria-label={zh ? "清理噪声" : "Clean noise"}>
      <header className="flex shrink-0 items-start gap-3 border-b border-ui bg-raised px-4 py-4 sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-accent"><Eraser className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="content-cleanup-title" className="text-base font-semibold text-primary">{view === "rules" ? (zh ? "噪声规则库" : "Noise rule library") : (zh ? "清理噪声" : "Clean noise")}</h2>
          {view === "review" ? <p className="mt-1 text-xs leading-5 text-secondary">{selection ? (zh ? "只审查你在当前 Markdown 源码中选择的内容；应用后会创建正常的消息版本。" : "Review only the selected Markdown source. Applying creates a normal message version.") : initialScanId ? (zh ? "导入后的异步审查。确认前不会改变正文。" : "Post-import review. Content stays unchanged until you confirm.") : (zh ? "按规则扫描活动对话；归档对话永远不会被处理。" : "Scan active conversations with stored rules. Archived conversations are never included.")}</p> : null}
        </div>
        {view === "review" ? <button type="button" onClick={() => setView("rules")} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-ui bg-surface px-3 text-xs font-medium text-primary hover:bg-subtle"><BookOpen className="h-3.5 w-3.5" />{zh ? "规则库" : "Rules"}</button> : null}
        {onClose ? <button type="button" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle" aria-label={zh ? "关闭清理噪声" : "Close cleanup review"}><X className="h-4 w-4" /></button> : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {view === "rules" ? <ContentCleanupRuleSettings embedded onBack={() => setView("review")} /> : null}
        {view === "review" && selection ? <div className="mb-4 border-y border-ui bg-surface px-3 py-3"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-primary">{zh ? "当前选区" : "Current selection"}</span><span className="text-[11px] text-secondary">{Array.from(selection.text).length} {zh ? "个字符" : "characters"}</span></div><p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-secondary">{selection.text}</p></div> : null}
        {view === "review" && !initialScanId && !selection && !scanId ? <ScopePicker zh={zh} conversationId={conversationId} scopeType={scopeType} setScopeType={setScopeType} candidates={candidates} selectedConversationIds={selectedConversationIds} setSelectedConversationIds={setSelectedConversationIds} pending={startMutation.isPending} onStart={() => startMutation.mutate()} /> : null}
        {view === "review" && startMutation.isError ? <p className="mb-3 border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]" role="alert">{startMutation.error.message}</p> : null}
        {view === "review" && (startMutation.isPending || (scanId && !scanQuery.data)) ? <div className="flex items-center gap-2 py-8 text-sm text-secondary"><LoaderCircle className="h-4 w-4 animate-spin" />{selection ? (zh ? "正在校验选区…" : "Checking selection…") : (zh ? "正在准备噪声审查…" : "Preparing noise review…")}</div> : null}
        {view === "review" && status && !["READY", "FAILED", "STALE"].includes(status) ? <div className="space-y-2 py-6"><p className="text-sm text-secondary">{selection ? (zh ? "正在定位选区…" : "Locating selection…") : (zh ? "正在扫描消息…" : "Scanning messages…")}</p><div className="h-1.5 overflow-hidden rounded-full bg-subtle"><div className="h-full bg-accent transition-[width]" style={{ width: `${scanQuery.data?.progress ?? 2}%` }} /></div><p className="text-xs text-secondary">{scanQuery.data?.processed_messages ?? 0} / {scanQuery.data?.total_messages ?? 0}</p></div> : null}
        {view === "review" && status === "FAILED" ? <p className="border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]" role="alert">{scanQuery.data?.error_message ?? (zh ? "扫描失败。" : "Scan failed.")}</p> : null}
        {view === "review" && status === "READY" && (scanQuery.data?.occurrence_count ?? 0) === 0 ? <EmptyReview zh={zh} dismissing={dismissMutation.isPending} onDone={() => dismissMutation.mutate()} /> : null}
        {view === "review" && status === "READY" && (scanQuery.data?.occurrence_count ?? 0) > 0 ? <ReviewResults zh={zh} groups={groups} occurrences={occurrences} conversationId={conversationId} onLocate={onLocate} isSelected={isSelected} toggle={toggle} selectVisible={selectVisible} page={page} pageCount={pageCount} setPage={setPage} deleteCount={deleteCount} applying={applyMutation.isPending} dismissing={dismissMutation.isPending} onApply={() => applyMutation.mutate()} onDismiss={() => dismissMutation.mutate()} error={applyMutation.isError ? applyMutation.error.message : null} /> : null}
      </div>
    </section>
  );
}

function ScopePicker({ zh, conversationId, scopeType, setScopeType, candidates, selectedConversationIds, setSelectedConversationIds, pending, onStart }: { zh: boolean; conversationId?: string; scopeType: ScopeType; setScopeType: (scope: ScopeType) => void; candidates: ConversationListItem[]; selectedConversationIds: string[]; setSelectedConversationIds: React.Dispatch<React.SetStateAction<string[]>>; pending: boolean; onStart: () => void }) {
  const disabled = pending || (scopeType === "CURRENT_CONVERSATION" ? !conversationId : scopeType === "ALL_ACTIVE" ? !candidates.length : !selectedConversationIds.length);
  return <div className="mb-4 space-y-3"><label className="block text-xs font-semibold text-secondary">{zh ? "扫描范围" : "Scan scope"}<select value={scopeType} onChange={(event) => setScopeType(event.target.value as ScopeType)} className="mt-1 min-h-10 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary"><option value="CURRENT_CONVERSATION">{zh ? "当前对话" : "Current conversation"}</option><option value="SELECTED_CONVERSATIONS">{zh ? "选择活动对话" : "Selected active conversations"}</option><option value="ALL_ACTIVE">{zh ? "全部活动对话" : "All active conversations"}</option></select></label>{scopeType === "SELECTED_CONVERSATIONS" ? <div className="max-h-48 divide-y divide-ui overflow-y-auto border-y border-ui">{candidates.map((item) => <label key={item.id} className="flex items-center gap-2 px-2 py-2 text-sm text-primary hover:bg-subtle"><input type="checkbox" checked={selectedConversationIds.includes(item.id)} onChange={() => setSelectedConversationIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} className="h-4 w-4 accent-[var(--accent)]" /><span className="truncate">{item.display_title}</span></label>)}{!candidates.length ? <p className="px-2 py-4 text-xs text-secondary">{zh ? "没有找到活动对话。" : "No active conversations found."}</p> : null}</div> : null}{scopeType === "ALL_ACTIVE" ? <p className="text-xs text-secondary">{candidates.length} {zh ? "个活动对话将被扫描；归档对话不受影响。" : "active conversations will be scanned; archived conversations are excluded."}</p> : null}<div className="flex justify-end"><button type="button" disabled={disabled} onClick={onStart} className="min-h-10 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{pending ? (zh ? "准备中…" : "Preparing…") : (zh ? "开始扫描" : "Start scan")}</button></div></div>;
}

function EmptyReview({ zh, dismissing, onDone }: { zh: boolean; dismissing: boolean; onDone: () => void }) {
  return <div className="py-12 text-center"><Check className="mx-auto h-8 w-8 text-accent" /><p className="mt-3 text-sm font-medium text-primary">{zh ? "没有发现可安全处理的内容" : "No safe cleanup candidates found"}</p><p className="mt-1 text-xs text-secondary">{zh ? "正文保持不变；完成后本次扫描记录会被删除。" : "Content is unchanged. Finishing deletes this scan record."}</p><button type="button" disabled={dismissing} onClick={onDone} className="mt-4 min-h-9 rounded-lg border border-ui bg-surface px-3 text-xs font-medium text-primary hover:bg-subtle">{zh ? "完成" : "Done"}</button></div>;
}

function ReviewResults({ zh, groups, occurrences, conversationId, onLocate, isSelected, toggle, selectVisible, page, pageCount, setPage, deleteCount, applying, dismissing, onApply, onDismiss, error }: { zh: boolean; groups: Record<string, CleanupOccurrenceRead[]>; occurrences: CleanupOccurrenceRead[]; conversationId?: string; onLocate?: (occurrence: CleanupOccurrenceRead) => Promise<void> | void; isSelected: (item: CleanupOccurrenceRead) => boolean; toggle: (item: CleanupOccurrenceRead) => void; selectVisible: () => void; page: number; pageCount: number; setPage: React.Dispatch<React.SetStateAction<number>>; deleteCount: number; applying: boolean; dismissing: boolean; onApply: () => void; onDismiss: () => void; error: string | null }) {
  return <div className="space-y-5"><div className="flex items-center justify-between gap-3 border-b border-ui pb-3"><p className="text-sm font-medium text-primary">{occurrences.length} {zh ? "个当前页候选" : "candidates on this page"}</p><button type="button" onClick={selectVisible} className="text-xs font-medium text-accent underline">{zh ? "选择本页可处理项" : "Select safe matches on page"}</button></div>{Object.entries(groups).map(([name, items]) => <section key={name}><h3 className="mb-2 text-xs font-semibold text-secondary">{name} · {items.length}</h3><div className="divide-y divide-ui border-y border-ui">{items.map((item) => <article key={item.id} className="py-3"><div className="flex items-start gap-3"><input type="checkbox" checked={isSelected(item)} disabled={item.decision === "PROTECTED" || item.stale} onChange={() => toggle(item)} className="mt-1 h-4 w-4 accent-[var(--accent)]" aria-label={`${zh ? "处理" : "Process"} ${item.match_text}`} /><div className="min-w-0 flex-1"><p className="text-sm leading-6 text-primary"><span className="text-secondary">{item.context_before}</span><mark className="rounded bg-[var(--warning-soft)] px-0.5 text-primary">{item.match_text}</mark><span className="text-secondary">{item.context_after}</span></p><p className="mt-1 text-[11px] text-secondary"><span className="font-medium text-primary">{item.conversation_title}</span> · {item.role} · {zh ? "第" : "line "}{item.line_start}{zh ? "行" : ""} · {item.confidence}{item.stale ? (zh ? " · 版本已变化" : " · version changed") : ""}</p>{item.decision === "PROTECTED" ? <p className="mt-1 text-xs text-[var(--warning)]">{zh ? "该选区位于受保护的 Markdown 结构内，或删除后会使消息为空。" : "This selection is inside protected Markdown or would empty the message."}</p> : null}{onLocate && item.conversation_id === conversationId ? <button type="button" onClick={() => void onLocate(item)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent underline"><Eye className="h-3.5 w-3.5" />{zh ? "在正文中查看" : "Locate in reader"}</button> : null}</div></div></article>)}</div></section>)}{pageCount > 1 ? <nav className="flex items-center justify-between border-t border-ui pt-3" aria-label={zh ? "候选分页" : "Candidate pages"}><button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-secondary hover:bg-subtle disabled:opacity-40"><ChevronLeft className="h-4 w-4" />{zh ? "上一页" : "Previous"}</button><span className="text-xs text-secondary">{page + 1} / {pageCount}</span><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-secondary hover:bg-subtle disabled:opacity-40">{zh ? "下一页" : "Next"}<ChevronRight className="h-4 w-4" /></button></nav> : null}<div className="sticky bottom-0 -mx-4 border-t border-ui bg-page/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5"><div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between"><button type="button" disabled={dismissing} onClick={onDismiss} className="min-h-10 rounded-lg px-3 text-xs font-medium text-secondary hover:bg-subtle">{zh ? "忽略并删除本次记录" : "Ignore and delete this review"}</button><button type="button" disabled={applying || deleteCount === 0} onClick={onApply} className="min-h-10 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50">{applying ? (zh ? "正在应用…" : "Applying…") : (zh ? `应用 ${deleteCount} 项清理` : `Apply ${deleteCount} cleanup${deleteCount === 1 ? "" : "s"}`)}</button></div>{error ? <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{error}</p> : null}</div></div>;
}
