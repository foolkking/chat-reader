"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  Eraser,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ContentCleanupRuleSettings } from "../../components/content-cleanup-rule-settings";
import { usePreferences } from "../../components/preferences-provider";
import { useInteractionDialog } from "../../components/interaction-dialog-provider";
import {
  createCleanupScan,
  dismissCleanupScan,
  getCleanupScan,
  getConversations,
  rescanCleanup,
} from "../../lib/api";
import { CleanupReviewWorkspace } from "./cleanup-review-workspace";
import { useDialogFocus } from "../../components/use-dialog-focus";
import type {
  CleanupOccurrenceRead,
  ConversationListItem,
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
  onApplied?: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
};

export function ContentCleanupDialog(
  props: ContentCleanupPanelProps & { open: boolean },
) {
  const { open, onClose, ...panelProps } = props;
  const [dirty, setDirty] = useState(false);
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
        className="relative h-[min(88dvh,800px)] max-h-[88dvh] min-h-0 w-full overflow-hidden rounded-t-2xl border border-ui bg-page shadow-2xl sm:max-w-6xl sm:rounded-xl"
      >
        <ContentCleanupPanel {...panelProps} onClose={() => void close()} onDirtyChange={setDirty} />
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
}: ContentCleanupPanelProps) {
  const { resolvedLocale } = usePreferences();
  const zh = resolvedLocale === "zh-CN";
  const autoStartedRef = useRef(false);
  const [view, setView] = useState<"review" | "rules">("review");
  const [draftDirty, setDraftDirty] = useState(false);
  useEffect(() => { onDirtyChange?.(draftDirty); }, [draftDirty, onDirtyChange]);
  const [scanId, setScanId] = useState<string | null>(initialScanId ?? null);
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
    queryFn: () => getCleanupScan(scanId!),
    enabled: Boolean(scanId),
    refetchInterval: (query) =>
      ["READY", "FAILED", "STALE"].includes(query.state.data?.status ?? "")
        ? false
        : 1000,
  });
  const dismissMutation = useMutation({
    mutationFn: () => dismissCleanupScan(scanId!),
    onSuccess: () => onClose?.(),
  });
  const retryScan = useMutation({ mutationFn: () => rescanCleanup(scanId!), onSuccess: (scan) => setScanId(scan.id) });
  const status = scanQuery.data?.status;

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col bg-page"
      aria-label={zh ? "清理噪声" : "Clean noise"}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-ui bg-raised px-4 py-4 sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-accent">
          <Eraser className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
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
          {view === "review" ? (
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
        {view === "review" ? (
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
        {view === "rules" ? (
          <ContentCleanupRuleSettings
            embedded
            onBack={() => setView("review")}
            onDirtyChange={setDraftDirty}
          />
        ) : null}
        {view === "review" && activeSelection ? (
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
        {scanQuery.isError ? <div role="alert" className="space-y-2 text-sm text-[var(--danger)]"><p>{scanQuery.error.message}</p><button type="button" className="btn-secondary min-h-11 px-3" onClick={() => void scanQuery.refetch()}>{zh ? "重试读取" : "Retry loading"}</button></div> : null}
        {view === "review" &&
        status &&
        !["READY", "FAILED", "STALE"].includes(status) ? (
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
        {view === "review" && (status === "FAILED" || status === "STALE") ? (
          <div className="space-y-2">
          <p
            className="border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]"
            role="alert"
          >
            {scanQuery.data?.error_message ??
              (zh ? "扫描失败。" : "Scan failed.")}
          </p>
          <button type="button" disabled={retryScan.isPending} className="btn-secondary min-h-11 px-3 text-sm" onClick={() => retryScan.mutate()}>{zh ? "重新扫描原对话" : "Rescan conversations"}</button>
          {retryScan.isError ? <p role="alert" className="text-sm text-[var(--danger)]">{retryScan.error.message}</p> : null}
          </div>
        ) : null}
        {view === "review" &&
        status === "READY" &&
        (scanQuery.data?.occurrence_count ?? 0) === 0 ? (
          <EmptyReview
            zh={zh}
            dismissing={dismissMutation.isPending}
            onDone={() => dismissMutation.mutate()}
          />
        ) : null}
        {view === "review" &&
        status === "READY" &&
        (scanQuery.data?.occurrence_count ?? 0) > 0 ? (
          <CleanupReviewWorkspace
            key={scanId}
            scan={scanQuery.data!}
            conversationId={conversationId}
            onLocate={onLocate}
            onApplied={onApplied}
            onClose={onClose}
            onRescan={(id) => { setScanWholeConversation(true); setScanId(id); }}
            onDirtyChange={setDraftDirty}
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
  dismissing,
  onDone,
}: {
  zh: boolean;
  dismissing: boolean;
  onDone: () => void;
}) {
  return (
    <div className="py-12 text-center">
      <Check className="mx-auto h-8 w-8 text-accent" />
      <p className="mt-3 text-sm font-medium text-primary">
        {zh ? "没有发现可安全处理的内容" : "No safe cleanup candidates found"}
      </p>
      <p className="mt-1 text-xs text-secondary">
        {zh
          ? "正文保持不变；完成后本次扫描记录会被删除。"
          : "Content is unchanged. Finishing deletes this scan record."}
      </p>
      <button
        type="button"
        disabled={dismissing}
        onClick={onDone}
        className="mt-4 min-h-9 rounded-lg border border-ui bg-surface px-3 text-xs font-medium text-primary hover:bg-subtle"
      >
        {zh ? "完成" : "Done"}
      </button>
    </div>
  );
}
