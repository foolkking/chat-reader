"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  Eraser,
  LoaderCircle,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContentCleanupRuleSettings } from "../../components/content-cleanup-rule-settings";
import { usePreferences } from "../../components/preferences-provider";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import {
  createCleanupScan,
  getCleanupScan,
  getConversations,
  ApiRequestError,
  getCleanupOutcome,
  getCleanupDismissal,
} from "../../lib/api";
import { CleanupReviewWorkspace } from "./cleanup-review-workspace";
import { CleanupCompletion } from "./cleanup-completion";
import { CleanupDismissAction } from "./cleanup-dismiss-action";
import { CleanupScanProgress } from "./cleanup-scan-progress";
import { CleanupRescanControls, useCleanupRescan } from "./use-cleanup-rescan";
import { useDialogFocus } from "../../components/use-dialog-focus";
import type {
  CleanupOccurrenceRead,
  ConversationListItem,
  CleanupScanRead,
} from "../../lib/types";

type ScopeType =
  | "CURRENT_CONVERSATION"
  | "SELECTED_CONVERSATIONS"
  | "ALL_ACTIVE";

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
  onApplied?: (signal?: AbortSignal) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
  onResultViewChange?: (visible: boolean) => void;
};

export function ContentCleanupDialog(
  props: ContentCleanupPanelProps & { open: boolean },
) {
  const { open, onClose, ...panelProps } = props;
  const [dirty, setDirty] = useState(false);
  const [resultView, setResultView] = useState(false);
  useEffect(() => { if (!open) setResultView(false); }, [open]);
  const { confirm } = useInteractionDialog();
  const zh = usePreferences().resolvedLocale === "zh-CN";
  const close = async () => {
    if (dirty && !await confirm({ title: zh ? "放弃未保存的规则？" : "Discard unsaved rule?", confirmLabel: zh ? "放弃草稿" : "Discard draft" })) return;
    setDirty(false); onClose?.();
  };
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  const rootRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => { if (open) restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }, [open]);
  useDialogFocus({ open, rootRef, onClose: () => void close(), restoreFocus: () => restoreRef.current });
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[280] flex items-end justify-center bg-[var(--overlay)] sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="content-cleanup-title"
      data-testid="content-cleanup-dialog"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={() => void close()}
        aria-label="Close cleanup review"
      />
      <div
        ref={rootRef}
        tabIndex={-1}
        data-testid="content-cleanup-surface"
        className={`relative max-h-[88dvh] min-h-0 w-full overflow-hidden rounded-t-2xl border border-ui bg-page shadow-2xl sm:rounded-xl ${resultView ? "sm:max-w-xl" : "h-[min(88dvh,800px)] sm:max-w-6xl"}`}
      >
        <ContentCleanupPanel {...panelProps} onClose={() => void close()} onDirtyChange={setDirty} onResultViewChange={setResultView} />
      </div>
    </div>
  );
}

export function ContentCleanupPanel({
  conversationId,
  initialScanId,
  selection,
  onClose,
  onLocate,
  onApplied,
  onDirtyChange,
  onResultViewChange,
}: ContentCleanupPanelProps) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const autoStartedRef = useRef(false);
  const [view, setView] = useState<"review" | "rules">("review");
  const [draftDirty, setDraftDirty] = useState(false);
  useEffect(() => { onDirtyChange?.(draftDirty); }, [draftDirty, onDirtyChange]);
  const [scanId, setScanId] = useState<string | null>(initialScanId ?? null);
  const [returnToScans, setReturnToScans] = useState<string[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastScan = useRef(scanId);
  useEffect(() => {
    if (lastScan.current === scanId) return;
    lastScan.current = scanId;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.closest("section")?.querySelector('[data-testid="content-cleanup-scroll"]')?.scrollTo({ top: 0 });
  }, [scanId]);
  const showRescan = useCallback((scan: CleanupScanRead) => {
    setReturnToScans([]); setScanWholeConversation(true); setScanId(scan.id);
  }, []);
  const rescan = useCleanupRescan(scanId, showRescan);
  const [resultScanId, setResultScanId] = useState<string | null>(null);
  const acknowledgeResult = useCallback((value: boolean) => setResultScanId(value ? scanId : null), [scanId]);
  const [scopeType, setScopeType] = useState<ScopeType>("CURRENT_CONVERSATION");
  const [scanWholeConversation, setScanWholeConversation] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState<
    string[]
  >(conversationId ? [conversationId] : []);
  const candidatesQuery = useQuery({
    queryKey: ["content-cleanup-conversations"],
    queryFn: () => getConversations({ statusScope: "active", limit: 5000 }),
    enabled:
      !initialScanId && !selection && scopeType !== "CURRENT_CONVERSATION",
    staleTime: 30_000,
  });
  const candidates = candidatesQuery.data ?? [];
  // A source-editor selection is a focused review, not an implicit claim that
  // the rest of the conversation was scanned. The owner can promote it to a
  // full current-conversation scan without leaving this review surface.
  const activeSelection = selection && !scanWholeConversation ? selection : null;
  const startMutation = useMutation({
    mutationFn: () => {
      const ids = activeSelection
        ? conversationId
          ? [conversationId]
          : []
        : scopeType === "CURRENT_CONVERSATION"
          ? conversationId
            ? [conversationId]
            : []
          : scopeType === "ALL_ACTIVE"
            ? candidates.map((item) => item.id)
            : selectedConversationIds;
      return createCleanupScan({
        source:
          activeSelection || scopeType === "CURRENT_CONVERSATION"
            ? "READER"
            : "BATCH",
        scope_type: activeSelection ? "CURRENT_CONVERSATION" : scopeType,
        conversation_ids: ids,
        message_id: activeSelection?.messageId,
        selection_start_offset: activeSelection?.startOffset,
        selection_end_offset: activeSelection?.endOffset,
        selection_text: activeSelection?.text,
      });
    },
    onSuccess: (scan) => {
      setScanId(scan.id);
    },
  });
  useEffect(() => {
    if (!activeSelection || initialScanId || scanId || autoStartedRef.current) return;
    autoStartedRef.current = true;
    startMutation.mutate();
  }, [activeSelection, initialScanId, scanId, startMutation]);
  useEffect(() => {
    if (!scanWholeConversation || initialScanId || scanId || autoStartedRef.current) return;
    autoStartedRef.current = true;
    startMutation.mutate();
  }, [initialScanId, scanId, scanWholeConversation, startMutation]);

  const scanQuery = useQuery({
    queryKey: ["content-cleanup-scan", scanId],
    queryFn: ({ signal }) => getCleanupScan(scanId!, signal),
    staleTime: 0,
    enabled: Boolean(scanId),
    retry: false,
    refetchInterval: (query) =>
      query.state.error || ["READY", "FAILED", "STALE", "CANCELLED"].includes(query.state.data?.status ?? "")
        ? false
        : 1000,
  });
  const missingScan = scanQuery.error instanceof ApiRequestError && scanQuery.error.status === 404;
  const outcome = useQuery({ queryKey: ["cleanup-outcome", scanId], queryFn: ({ signal }) => getCleanupOutcome(scanId!, signal), enabled: Boolean(scanId) && missingScan, retry: false });
  const dismissal = useQuery({ queryKey: ["cleanup-dismissal", scanId], queryFn: ({ signal }) => getCleanupDismissal(scanId!, signal), enabled: Boolean(scanId) && missingScan && outcome.isError, retry: false });
  const dismissed = dismissal.data?.status === "DISMISSED";
  const status = scanQuery.data?.status;
  const emptyReview = !scanQuery.isError && status === "READY" && scanQuery.data?.occurrence_count === 0;
  const compactScan = ["QUEUED", "SCANNING", "FAILED", "CANCELLED"].includes(status ?? "");
  const resultView = view === "review" && Boolean(scanId && (compactScan || emptyReview || dismissed || resultScanId === scanId || (missingScan && outcome.data?.status === "COMPLETED")));
  useEffect(() => { onResultViewChange?.(resultView); }, [onResultViewChange, resultView]);

  return (
    <section
      className={`flex min-h-0 w-full flex-col bg-page ${resultView ? "max-h-[88dvh]" : "h-full"}`}
      aria-label={zh ? "清理噪声" : "Clean noise"}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-ui bg-raised px-4 py-4 sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-accent">
          <Eraser className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            ref={headingRef}
            tabIndex={-1}
            id="content-cleanup-title"
            className="text-base font-semibold text-primary"
          >
            {view === "rules"
              ? zh
                ? "噪声规则库"
                : "Noise rule library"
              : zh
                ? "清理噪声"
                : "Clean noise"}
          </h2>
          {view === "review" && !resultView ? (
            <p className="mt-1 text-xs leading-5 text-secondary">
              {activeSelection
                ? zh
                  ? "只审查你在当前 Markdown 源码中选择的内容；应用后会创建正常的消息版本。"
                  : "Review only the selected Markdown source. Applying creates a normal message version."
                : scanQuery.data?.source === "IMPORT"
                  ? zh
                    ? "导入后的异步审查。确认前不会改变正文。"
                    : "Post-import review. Content stays unchanged until you confirm."
                  : zh
                    ? "按规则扫描活动对话；归档对话永远不会被处理。"
                    : "Scan active conversations with stored rules. Archived conversations are never included."}
            </p>
          ) : null}
        </div>
        {view === "review" && (!resultView || emptyReview) ? (
          <button
            type="button"
            onClick={() => setView("rules")}
            disabled={draftDirty}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-ui bg-surface px-3 text-xs font-medium text-primary hover:bg-subtle"
          >
            <BookOpen className="h-3.5 w-3.5" />
            {zh ? "规则库" : "Rules"}
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle"
            aria-label={zh ? "关闭清理噪声" : "Close cleanup review"}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
        data-testid="content-cleanup-scroll"
      >
        {view === "review" && (returnToScans.length > 0 || scanQuery.data?.previous_scan_id) ? <nav aria-label={zh ? "审查切换" : "Review navigation"} className="mb-3 flex flex-wrap items-center gap-2 border-b border-ui pb-3 text-xs">
          <span className="text-secondary">{returnToScans.length ? (zh ? "正在查看先前审查" : "Viewing a previous review") : (zh ? "这是重新扫描的审查" : "This is a fresh review")}</span>
          {returnToScans.length ? <button type="button" disabled={rescan.blocking || draftDirty} className="btn-secondary min-h-11 px-3" onClick={() => { setScanId(returnToScans[returnToScans.length - 1]); setReturnToScans(items => items.slice(0, -1)); }}>{zh ? "返回较新审查" : "Return to newer review"}</button> : null}
          {scanQuery.data?.previous_scan_id ? <button type="button" disabled={rescan.blocking || draftDirty} className="min-h-11 px-2 text-accent underline" onClick={() => { setReturnToScans(items => [...items, scanId!]); setScanId(scanQuery.data!.previous_scan_id!); }}>{zh ? "查看上次审查与选择" : "View previous review and selections"}</button> : null}
        </nav> : null}
        {view === "rules" ? (
          <ContentCleanupRuleSettings
            embedded
            onBack={() => setView("review")}
            onDirtyChange={setDraftDirty}
            onOpenTasks={() => { onClose?.(); window.dispatchEvent(new Event("chat-reader:open-task-center")); }}
          />
        ) : null}
        {view === "review" && activeSelection && !resultView ? (
          <div className="mb-4 border-y border-ui bg-surface px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-primary">
                {zh ? "当前选区" : "Current selection"}
              </span>
              <span className="text-[11px] text-secondary">
                {Array.from(activeSelection.text).length}{" "}
                {zh ? "个字符" : "characters"}
              </span>
            </div>
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-secondary">
              {activeSelection.text}
            </p>
            {status === "READY" ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ui pt-3">
                <p className="text-xs text-secondary">
                  {zh
                    ? "当前只审查选区；要覆盖本对话的所有消息，请启动完整扫描。"
                    : "This review covers the selection only. Scan the full conversation to check every message."}
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    setScanWholeConversation(true);
                    setScanId(null);
                    autoStartedRef.current = false;
                  }}
                  className="min-h-9 rounded-lg border border-ui bg-page px-3 text-xs font-medium text-primary hover:bg-subtle"
                >
                  {zh ? "扫描整个当前对话" : "Scan full conversation"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {view === "review" && !initialScanId && !selection && !scanId ? (
          <ScopePicker
            zh={zh}
            conversationId={conversationId}
            scopeType={scopeType}
            setScopeType={setScopeType}
            candidates={candidates}
            selectedConversationIds={selectedConversationIds}
            setSelectedConversationIds={setSelectedConversationIds}
            pending={startMutation.isPending}
            onStart={() => startMutation.mutate()}
          />
        ) : null}
        {view === "review" && startMutation.isError ? (
          <p
            className="mb-3 border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
            role="alert"
          >
            {startMutation.error.message}
          </p>
        ) : null}
        {view === "review" &&
        (startMutation.isPending || (scanId && !scanQuery.data && !scanQuery.isError)) ? (
          <div className="flex items-center gap-2 py-8 text-sm text-secondary">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {activeSelection
              ? zh
                ? "正在校验选区…"
                : "Checking selection…"
              : zh
                ? "正在准备噪声审查…"
                : "Preparing noise review…"}
          </div>
        ) : null}
        {view === "review" && missingScan && (outcome.isLoading || (outcome.isError && dismissal.isLoading)) ? <p role="status">{zh ? "正在核对清理结果…" : "Checking cleanup result…"}</p> : null}
        {view === "review" ? (dismissed ? <div className="space-y-3 py-3"><p role="status" className="text-sm font-medium">{zh ? "本次审查已结束。" : "This review has ended."}</p>{onClose ? <button type="button" className="btn-primary min-h-11 px-4 text-sm" onClick={onClose}>{zh ? "完成" : "Done"}</button> : null}</div> : missingScan && outcome.data?.status === "COMPLETED" ? <CleanupCompletion result={outcome.data} onContinue={onClose} /> : scanQuery.isError && !outcome.isLoading && !(outcome.isError && dismissal.isLoading) ? <div role="alert" className="space-y-2 text-sm text-[var(--danger)]"><p>{zh ? "暂时无法读取此审查或确认完成结果。" : "This review or its completion could not be read."}</p><button type="button" className="btn-secondary min-h-11 px-3" onClick={() => { void scanQuery.refetch(); if (missingScan) { void outcome.refetch(); void dismissal.refetch(); } }}>{zh ? "重试读取" : "Retry loading"}</button></div> : null) : null}
        {view === "review" && !scanQuery.isError && scanQuery.data && ["QUEUED", "SCANNING"].includes(status ?? "") ? <CleanupScanProgress key={scanId} scan={scanQuery.data} /> : null}
        {view === "review" &&
        status &&
        !["READY", "FAILED", "STALE", "QUEUED", "SCANNING", "CANCELLED"].includes(status) ? (
          <div className="space-y-2 py-6">
            <p className="text-sm text-secondary">
              {activeSelection
                ? zh
                  ? "正在定位选区…"
                  : "Locating selection…"
                : zh
                  ? "正在扫描消息…"
                  : "Scanning messages…"}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${scanQuery.data?.progress ?? 2}%` }}
              />
            </div>
            <p className="text-xs text-secondary">
              {scanQuery.data?.processed_messages ?? 0} /{" "}
              {scanQuery.data?.total_messages ?? 0}
            </p>
          </div>
        ) : null}
        {view === "review" && status === "CANCELLED" ? <div className="space-y-3 py-2" data-testid="cleanup-scan-cancelled">
          <p role="status" className="text-sm font-medium">{zh ? "扫描已取消，正文保持不变。" : "Scan cancelled. Content is unchanged."}</p>
          <CleanupRescanControls rescan={rescan} selectedCount={0} />
          {onClose ? <button type="button" onClick={onClose} className="btn-secondary min-h-11 px-3 text-xs">{zh ? "关闭" : "Close"}</button> : null}
        </div> : null}
        {view === "review" && (status === "FAILED" || status === "STALE") ? (
          <div className="space-y-2">
          <p
            className="border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
            role="alert"
          >
            {scanQuery.data?.error_message ??
              (zh ? "扫描失败。" : "Scan failed.")}
          </p>
          <CleanupRescanControls rescan={rescan} selectedCount={scanQuery.data?.delete_count ?? 0} />
          </div>
        ) : null}
        {view === "review" &&
        !scanQuery.isError && status === "READY" &&
        (scanQuery.data?.occurrence_count ?? 0) === 0 ? (
          <EmptyReview
            zh={zh}
            scan={scanQuery.data!}
            onDone={onClose}
          />
        ) : null}
        {view === "review" &&
        !scanQuery.isError && status === "READY" &&
        (scanQuery.data?.occurrence_count ?? 0) > 0 ? (
          <CleanupReviewWorkspace
            key={scanId}
            scan={scanQuery.data!}
            conversationId={conversationId}
            onLocate={onLocate}
            onApplied={onApplied}
            onClose={onClose}
            rescan={rescan}
            onDirtyChange={setDraftDirty}
            onResultChange={acknowledgeResult}
          />
        ) : null}
      </div>
    </section>
  );
}

function ScopePicker({
  zh,
  conversationId,
  scopeType,
  setScopeType,
  candidates,
  selectedConversationIds,
  setSelectedConversationIds,
  pending,
  onStart,
}: {
  zh: boolean;
  conversationId?: string;
  scopeType: ScopeType;
  setScopeType: (scope: ScopeType) => void;
  candidates: ConversationListItem[];
  selectedConversationIds: string[];
  setSelectedConversationIds: React.Dispatch<React.SetStateAction<string[]>>;
  pending: boolean;
  onStart: () => void;
}) {
  const disabled =
    pending ||
    (scopeType === "CURRENT_CONVERSATION"
      ? !conversationId
      : scopeType === "ALL_ACTIVE"
        ? !candidates.length
        : !selectedConversationIds.length);
  return (
    <div className="mb-4 space-y-3">
      <label className="block text-xs font-semibold text-secondary">
        {zh ? "扫描范围" : "Scan scope"}
        <select
          value={scopeType}
          onChange={(event) => setScopeType(event.target.value as ScopeType)}
          className="mt-1 min-h-10 w-full rounded-lg border border-ui bg-surface px-3 text-sm text-primary"
        >
          <option value="CURRENT_CONVERSATION">
            {zh ? "当前对话" : "Current conversation"}
          </option>
          <option value="SELECTED_CONVERSATIONS">
            {zh ? "选择活动对话" : "Selected active conversations"}
          </option>
          <option value="ALL_ACTIVE">
            {zh ? "全部活动对话" : "All active conversations"}
          </option>
        </select>
      </label>
      {scopeType === "SELECTED_CONVERSATIONS" ? (
        <div className="max-h-48 divide-y divide-ui overflow-y-auto border-y border-ui">
          {candidates.map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-2 px-2 py-2 text-sm text-primary hover:bg-subtle"
            >
              <input
                type="checkbox"
                checked={selectedConversationIds.includes(item.id)}
                onChange={() =>
                  setSelectedConversationIds((current) =>
                    current.includes(item.id)
                      ? current.filter((id) => id !== item.id)
                      : [...current, item.id],
                  )
                }
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span className="truncate">{item.display_title}</span>
            </label>
          ))}
          {!candidates.length ? (
            <p className="px-2 py-4 text-xs text-secondary">
              {zh ? "没有找到活动对话。" : "No active conversations found."}
            </p>
          ) : null}
        </div>
      ) : null}
      {scopeType === "ALL_ACTIVE" ? (
        <p className="text-xs text-secondary">
          {candidates.length}{" "}
          {zh
            ? "个活动对话将被扫描；归档对话不受影响。"
            : "active conversations will be scanned; archived conversations are excluded."}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={disabled}
          onClick={onStart}
          className="min-h-10 rounded-lg bg-[var(--text)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-50"
        >
          {pending
            ? zh
              ? "准备中…"
              : "Preparing…"
            : zh
              ? "开始扫描"
              : "Start scan"}
        </button>
      </div>
    </div>
  );
}

function EmptyReview({
  zh,
  scan,
  onDone,
}: {
  zh: boolean;
  scan: CleanupScanRead;
  onDone?: () => void;
}) {
  return (
    <div className="space-y-3 py-3" aria-label={zh ? "扫描结果" : "Scan result"}>
      <Check className="h-6 w-6 text-accent" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-primary">
        {zh ? "当前规则未发现噪声候选" : "No noise candidates found with the current rules"}
      </p>
      <p className="mt-1 text-xs text-secondary">
        {zh
          ? "正文保持不变。"
          : "Content is unchanged."}
      </p>
      <CleanupDismissAction key={scan.id} scan={scan} finish onDismissed={onDone} />
    </div>
  );
}
