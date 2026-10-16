"use client";

import { importErrorMessage, useImportCopy, type ImportCopy } from "./import-workspace-copy";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LoaderCircle, ScanSearch, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { ApiRequestError, cancelAdaptiveImportSession, commitImport, createAdaptiveImportSession, getAdaptiveImportSession, getImportStatus, previewImport, retryTask } from "../../lib/api";
import type { AdaptiveImportSession, CommitImportResponse, ImportDuplicatePolicy, ImportPreviewResponse } from "../../lib/types";
import { readAccountCapabilities } from "../../lib/auth-client";
import { SupportLimitAction } from "../../components/support-limit-action";
import { ImportPreviewCard } from "./import-preview-card";
import { AdaptiveImportWorkspace } from "./adaptive-import-workspace";
import { FormatConversionGuide } from "./format-conversion-guide";
import { ImportNoiseReview } from "./import-noise-review";

type ImportMode = "adaptive" | "archive";
type ImportSessionRestoreState = {
  phase: "idle" | "loading" | "error";
  error: unknown | null;
};
const ACTIVE_SESSION_KEY = "chat-reader:adaptive-import-session";

function sessionStorageKey(repairProfileId?: string | null): string {
  return repairProfileId ? `${ACTIVE_SESSION_KEY}:repair:${repairProfileId}` : ACTIVE_SESSION_KEY;
}

export function ImportPanel({
  repairProfileId,
  initialMode = "adaptive",
  onImportCommitted,
  onWorkspaceChange,
  onMappingStateChange,
}: {
  repairProfileId?: string | null;
  initialMode?: ImportMode;
  onImportCommitted?: () => void;
  onWorkspaceChange?: (open: boolean) => void;
  onMappingStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
} = {}) {
  const tr = useImportCopy();
  const queryClient = useQueryClient();
  const capabilities = useQuery({ queryKey: ["account-capabilities"], queryFn: ({ signal }) => readAccountCapabilities(signal), staleTime: 0, refetchOnWindowFocus: true });
  const router = useRouter();
  const [mode, setMode] = useState<ImportMode>(initialMode);
  const [files, setFiles] = useState<File[]>([]);
  const [archivePreview, setArchivePreview] = useState<ImportPreviewResponse | null>(null);
  const [session, setSession] = useState<AdaptiveImportSession | null>(null);
  const [sessionRestore, setSessionRestore] = useState<ImportSessionRestoreState>({ phase: "idle", error: null });
  const [sessionRestoreRetry, setSessionRestoreRetry] = useState(0);
  const [pendingImportId, setPendingImportId] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitImportResponse | null>(null);
  const [terminalImportError, setTerminalImportError] = useState<string | null>(null);
  const [terminalImportId, setTerminalImportId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [conversionOpen, setConversionOpen] = useState(false);
  const conversionId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [duplicatePolicy, setDuplicatePolicy] = useState<ImportDuplicatePolicy>("clone");
  const completedImportRef = useRef<string | null>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const activeSessionKey = sessionStorageKey(repairProfileId);
  const largestFileMiB = Math.ceil(files.reduce((largest, file) => Math.max(largest, file.size), 0) / (1024 * 1024));
  const fileOverLimit = capabilities.data && largestFileMiB > capabilities.data.maximum_import_size_mb;

  useEffect(() => onWorkspaceChange?.(Boolean(session)), [onWorkspaceChange, session]);
  useEffect(() => {
    let active = true;
    const importId = window.sessionStorage.getItem(activeSessionKey);
    if (!importId || session) return;
    setSessionRestore({ phase: "loading", error: null });
    void getAdaptiveImportSession(importId)
      .then((restored) => {
        if (!active) return;
        if (["COMPLETED", "CANCELED", "FAILED"].includes(restored.state)) {
          window.sessionStorage.removeItem(activeSessionKey);
          setSessionRestore({ phase: "idle", error: null });
          return;
        }
        setSession(restored);
        setSessionRestore({ phase: "idle", error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSessionRestore({ phase: "error", error });
      });
    return () => {
      active = false;
    };
  }, [activeSessionKey, session, sessionRestoreRetry]);

  const finishCommittedImport = useCallback((result: CommitImportResponse) => {
    if (completedImportRef.current === result.import_id) return;
    completedImportRef.current = result.import_id;
    setTerminalImportError(null);
    setTerminalImportId(null);
    window.sessionStorage.removeItem(activeSessionKey);
    // The adaptive workspace owns the pre-commit session. Once the server has
    // committed it, release that surface so the terminal result summary can be
    // rendered and the user can choose where to go next.
    setSession(null);
    setPendingImportId(null);
    setCommitResult(result);
    void queryClient.invalidateQueries({ queryKey: ["active-tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
  }, [activeSessionKey, queryClient]);
  const finishTerminalImport = useCallback((result: CommitImportResponse) => {
    setPendingImportId(null);
    setCommitResult(null);
    setTerminalImportId(result.import_id);
    setTerminalImportError(result.status === "cancelled" ? "IMPORT_COMMIT_CANCELLED" : "IMPORT_COMMIT_FAILED");
  }, []);

  const importStatusQuery = useQuery({
    queryKey: ["import-status", pendingImportId],
    queryFn: () => getImportStatus(pendingImportId!),
    enabled: Boolean(pendingImportId),
    refetchInterval: (query) => ["queued", "processing"].includes(query.state.data?.status ?? "") ? 1200 : false,
  });
  useEffect(() => {
    const result = importStatusQuery.data;
    if (!result) return;
    if (result.status === "committed") finishCommittedImport(result);
    else if (result.status === "failed" || result.status === "cancelled") finishTerminalImport(result);
  }, [finishCommittedImport, finishTerminalImport, importStatusQuery.data]);

  const adaptiveMutation = useMutation({
    mutationFn: (selectedFiles: File[]) => createAdaptiveImportSession(selectedFiles, repairProfileId),
    onSuccess: (result) => {
      window.sessionStorage.setItem(activeSessionKey, result.import_id);
      setSession(result);
      setArchivePreview(null);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: cancelAdaptiveImportSession,
    onSuccess: () => {
      window.sessionStorage.removeItem(activeSessionKey);
      reset("adaptive");
    },
  });
  const archiveMutation = useMutation({
    mutationFn: previewImport,
    onSuccess: (result) => { setArchivePreview(result); setSession(null); },
  });
  const commitMutation = useMutation({
    mutationFn: ({ importId, policy }: { importId: string; policy: ImportDuplicatePolicy }) => commitImport(importId, { duplicatePolicy: policy }),
    onSuccess: (result) => {
      setTerminalImportError(null);
      setCommitResult(result);
      if (result.status === "committed") finishCommittedImport(result);
      else if (result.status === "failed" || result.status === "cancelled") finishTerminalImport(result);
      else setPendingImportId(result.import_id);
    },
  });
  const retryImportMutation = useMutation({
    mutationFn: (importId: string) => retryTask(importId),
    onSuccess: (task) => {
      setTerminalImportError(null);
      setTerminalImportId(null);
      setCommitResult(null);
      setPendingImportId(task.job_id);
      if (session) {
        void getAdaptiveImportSession(task.job_id).then(setSession).catch(() => undefined);
      }
    },
  });
  const busy = sessionRestore.phase === "loading" || adaptiveMutation.isPending || archiveMutation.isPending || commitMutation.isPending || retryImportMutation.isPending || Boolean(pendingImportId);

  const validationError = useMemo(() => {
    if (capabilities.data && !capabilities.data.allow_user_import) return tr("管理员已关闭导入功能。");
    if (capabilities.data && files.some((file) => file.size > capabilities.data.maximum_import_size_mb * 1024 * 1024)) return tr("单个文件不能超过当前上限 {0} MiB。", capabilities.data.maximum_import_size_mb);
    const totalLimit = capabilities.data?.maximum_import_total_mb;
    if (totalLimit != null && files.reduce((bytes, file) => bytes + file.size, 0) > totalLimit * 1024 * 1024) return tr("本批文件合计不能超过 {0} MiB，请分批导入。", totalLimit);
    return validateFiles(files, mode, tr);
  }, [files, mode, capabilities.data, tr]);

  function reset(nextMode = mode) {
    setMode(nextMode);
    setFiles([]);
    setArchivePreview(null);
    setSession(null);
    setSessionRestore({ phase: "idle", error: null });
    setPendingImportId(null);
    setCommitResult(null);
    setTerminalImportError(null);
    setTerminalImportId(null);
    setConversionOpen(false);
    setDuplicatePolicy("clone");
    completedImportRef.current = null;
    adaptiveMutation.reset();
    archiveMutation.reset();
    commitMutation.reset();
    retryImportMutation.reset();
  }

  function chooseFiles(nextFiles: File[], nextMode = mode) {
    if (busy) return;
    window.sessionStorage.removeItem(activeSessionKey);
    reset(nextMode);
    setFiles(nextFiles);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const nextFiles = Array.from(event.dataTransfer.files);
    chooseFiles(nextFiles);
  }

  if (session) {
    return (
      <AdaptiveImportWorkspace
        onMappingStateChange={onMappingStateChange}
        session={session}
        onSession={setSession}
        onBack={() => cancelMutation.mutate(session.import_id)}
        onImport={() => commitMutation.mutate({ importId: session.import_id, policy: duplicatePolicy })}
        importing={commitMutation.isPending || Boolean(pendingImportId)}
        error={retryImportMutation.error ?? cancelMutation.error ?? commitMutation.error ?? terminalImportError ?? importStatusQuery.data?.error_message ?? null}
        onRetryImport={terminalImportId ? () => retryImportMutation.mutate(terminalImportId) : undefined}
        retryingImport={retryImportMutation.isPending}
        statusError={importStatusQuery.error}
        onRetryStatus={() => { void importStatusQuery.refetch(); }}
        statusRetrying={importStatusQuery.isFetching}
      />
    );
  }

  const selectedLabel = files.length === 0 ? tr("尚未选择文件") : files.length === 1 ? files[0]?.name : tr("已选择 {0} 个文件", files.length);
  const archiveCanCommit = Boolean(archivePreview?.can_commit ?? archivePreview?.archive_summary);
  const totalOverLimit = capabilities.data?.maximum_import_total_mb != null && files.reduce((bytes, file) => bytes + file.size, 0) > capabilities.data.maximum_import_total_mb * 1024 * 1024;
  const sourceError = adaptiveMutation.error;
  const formatError = sourceError instanceof ApiRequestError && ["SOURCE_UNSUPPORTED", "JSON_INVALID", "NO_MESSAGE_STRUCTURE", "MARKDOWN_ENCODING_INVALID", "MARKDOWN_FENCE_UNCLOSED"].includes(sourceError.code ?? "");
  const showConversion = mode === "adaptive" && !commitResult && capabilities.data?.allow_user_import && !fileOverLimit && !totalOverLimit && files.length <= 500
    && !files.some(file => /\.(?:cr|zip)$/i.test(file.name) || file.name.toLowerCase() === "skill.md")
    && (!sourceError || formatError);

  return (
    <section className="space-y-5">
      {sessionRestore.phase === "loading" ? <p role="status" className="text-sm text-secondary">{tr("正在恢复已保存的导入会话…")}</p> : null}
      {sessionRestore.phase === "error" ? <ErrorLine message={sessionRestore.error} onRetry={() => { setSessionRestore({ phase: "loading", error: null }); setSessionRestoreRetry((attempt) => attempt + 1); }} /> : null}
      {repairProfileId ? <p className="text-sm leading-6 text-secondary">{tr("选择一组采用该格式的代表性源文件。验证成功后会保存新版本，旧版本继续可用。")}</p> : null}
      <div
        onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border border-dashed text-center transition-colors ${conversionOpen ? "px-4 py-3" : "px-6 py-8"} ${dragging ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-ui bg-subtle"}`}
      >
        {!conversionOpen ? <><UploadCloud className="mx-auto h-6 w-6 text-secondary" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-primary">{tr("拖放文件到这里")}</p>
        <p className="my-2 text-xs text-secondary">{tr("或")}</p></> : null}
        <label className={`btn-secondary inline-flex min-h-11 focus-within:ring-2 focus-within:ring-[var(--focus)] items-center justify-center px-4 text-sm font-medium ${busy ? "cursor-wait opacity-50" : "cursor-pointer"}`}>
          {mode === "adaptive" ? tr("选择 JSON / Markdown 文件") : tr("选择 .cr 归档")}
          <input ref={fileInputRef} disabled={busy} data-dialog-initial-focus="true" key={mode} type="file" data-testid="import-file-input" multiple={mode === "adaptive"} className="sr-only" accept={mode === "adaptive" ? ".json,.jsonl,.gz,.md,.markdown,.txt,.html,.htm" : ".cr"} onChange={(event) => { const selected = Array.from(event.currentTarget.files ?? []); if (selected.length) chooseFiles(selected); }} />
        </label>
        {files.length ? <p className="mt-3 break-all text-sm text-secondary">{selectedLabel}</p> : null}
      </div>
      {validationError ? <ErrorLine message={validationError} /> : null}
      {capabilities.data ? <SupportLimitAction capabilities={capabilities.data} limit="import_size_mb" active={Boolean(fileOverLimit || !capabilities.data.allow_user_import)} requestedValue={largestFileMiB} returnFocus={() => previewButtonRef.current} onReturn={() => { void capabilities.refetch(); }} /> : null}
      {capabilities.data ? <p className="text-xs text-secondary">{tr("当前单文件上限：")}{capabilities.data.maximum_import_size_mb} MiB</p> : capabilities.isError ? <div role="alert" className="text-sm text-secondary">{tr("无法读取导入限制。")}<button type="button" className="btn-secondary ml-2 min-h-11 px-3" onClick={() => void capabilities.refetch()}>{tr("重试")}</button></div> : <p role="status" className="text-sm text-secondary">{tr("正在读取导入限制…")}</p>}
      {adaptiveMutation.isError ? <ErrorLine message={adaptiveMutation.error} action="mutation" /> : null}
      {archiveMutation.isError ? <ErrorLine message={archiveMutation.error} action="mutation" /> : null}
      {commitMutation.isError ? <ErrorLine message={commitMutation.error} action="commit" /> : null}
      {(retryImportMutation.error || terminalImportError) ? <ErrorLine message={retryImportMutation.error ?? terminalImportError} action="commit" onRetry={terminalImportId ? () => retryImportMutation.mutate(terminalImportId) : undefined} retrying={retryImportMutation.isPending} /> : null}
      {importStatusQuery.error ? <ErrorLine message={importStatusQuery.error} onRetry={() => { void importStatusQuery.refetch(); }} retrying={importStatusQuery.isFetching} /> : null}
      {showConversion ? <div className="border-y border-ui">
        <button type="button" disabled={busy} aria-expanded={conversionOpen} aria-controls={conversionId} onClick={() => setConversionOpen(open => !open)} className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm text-secondary hover:text-primary disabled:opacity-50">{tr("格式不支持？")}<ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${conversionOpen ? "rotate-180" : ""}`} aria-hidden="true" /></button>
        {conversionOpen ? <div id={conversionId} className="pb-4 pt-2"><FormatConversionGuide resultAction={<button type="button" disabled={busy} className="btn-secondary min-h-11 px-3 text-sm" onClick={() => fileInputRef.current?.click()}>{files.length > 1 ? tr("重新选择本批文件") : tr("选择转换后的文件")}</button>} /></div> : null}
      </div> : null}
      <div className="flex flex-wrap gap-3">
        <button ref={previewButtonRef} type="button" disabled={!files.length || Boolean(validationError) || busy || !capabilities.data} data-testid="preview-import-button" onClick={() => mode === "archive" ? archiveMutation.mutate(files) : adaptiveMutation.mutate(files)} className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-sm font-medium">
          {busy ? <><LoaderCircle className="h-4 w-4 animate-spin" />{tr("正在识别格式")}</> : mode === "adaptive" ? <><ScanSearch className="h-4 w-4" />{tr("分析并继续")}</> : tr("检查归档")}
        </button>
        {archivePreview ? <button type="button" disabled={!archiveCanCommit || commitMutation.isPending} data-testid="commit-import-button" onClick={() => commitMutation.mutate({ importId: archivePreview.import_id, policy: duplicatePolicy })} className="btn-secondary min-h-10 px-4 text-sm font-medium">{commitMutation.isPending ? tr("正在导入") : tr("恢复归档")}</button> : null}
      </div>
      {archivePreview ? <ImportPreviewCard preview={archivePreview} /> : null}
      {archivePreview?.duplicate_conversation_id ? <div className="border-l-2 border-[var(--warning)] pl-3 text-sm text-secondary"><p>{tr("系统中已有相同归档。默认会创建副本，不覆盖原记录。")}</p><Link href={`/conversations/${archivePreview.duplicate_conversation_id}`} className="mt-2 inline-block font-medium text-accent underline">{tr("打开已有对话")}</Link></div> : null}
      {commitResult?.status === "committed" && !pendingImportId ? <ImportCompletionSummary result={commitResult} onClose={() => onImportCommitted?.()} onOpenFirst={(conversationId) => { onImportCommitted?.(); router.push(`/conversations/${conversationId}`); }} /> : null}
    </section>
  );
}

function ImportCompletionSummary({
  result,
  onClose,
  onOpenFirst,
}: {
  result: CommitImportResponse;
  onClose: () => void;
  onOpenFirst: (conversationId: string) => void;
}) {
  const tr = useImportCopy();
  const firstConversationId = result.conversation_ids[0] ?? null;
  const multiple = result.conversation_count > 1;
  const visibleIds = result.conversation_ids.slice(0, 8);
  return (
    <div role="status" data-testid="import-completion-summary" className="space-y-3 border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-4 text-sm text-primary">
      <div>
        <p className="font-semibold text-accent">{tr("导入已完成")}</p>
        <p className="mt-1 text-secondary">{tr("已提交 {0} 个对话，共 {1} 条消息。", result.conversation_count, result.message_count)}</p>
      </div>
      {result.warnings.length ? <div className="border-l-2 border-[var(--warning)] pl-3 text-xs text-secondary"><p className="font-medium text-primary">{tr("导入提示")}</p><ul className="mt-1 list-disc space-y-1 pl-4">{result.warnings.slice(0, 4).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div> : null}
      <ImportNoiseReview importId={result.import_id} />
      {visibleIds.length ? <div className="space-y-1"><p className="text-xs font-medium text-secondary">{multiple ? tr("已导入的对话") : tr("已导入对话")}</p><div className="flex flex-wrap gap-x-3 gap-y-1">{visibleIds.map((conversationId, index) => <button key={conversationId} type="button" onClick={() => onOpenFirst(conversationId)} className="text-xs text-accent underline underline-offset-2 hover:text-primary">{tr("打开第 {0} 条", index + 1)}</button>)}</div>{result.conversation_ids.length > visibleIds.length ? <p className="text-xs text-secondary">{tr("另有")}{result.conversation_ids.length - visibleIds.length} {tr("个对话可在资料库中查看。")}</p> : null}</div> : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {multiple ? <Link href="/" onClick={onClose} className="btn-primary min-h-9 px-3 text-sm font-medium">{tr("查看导入的对话")}</Link> : firstConversationId ? <button type="button" onClick={() => onOpenFirst(firstConversationId)} className="btn-primary min-h-9 px-3 text-sm font-medium">{tr("打开对话")}</button> : null}
        {multiple && firstConversationId ? <button type="button" onClick={() => onOpenFirst(firstConversationId)} className="btn-secondary min-h-9 px-3 text-sm font-medium">{tr("打开第一条")}</button> : null}
        <button type="button" onClick={onClose} className="btn-secondary min-h-9 px-3 text-sm font-medium">{tr("关闭")}</button>
      </div>
    </div>
  );
}

function validateFiles(files: File[], mode: ImportMode, tr: ImportCopy): string | null {
  if (!files.length) return null;
  const extensions = files.map((file) => fileExtension(file.name));
  if (mode === "archive") return files.length === 1 && extensions[0] === ".cr" ? null : tr(".cr 归档必须单独导入。");
  if (extensions.includes(".cr")) return tr("请在设置的数据与备份中恢复 .cr 归档。");
  if (files.some((file) => file.name.toLowerCase().endsWith(".context.zip"))) return tr("请打开目标对话，在批注旁的上下文面板中更新 Current / Index。");
  if (files.some((file) => file.name.toLowerCase() === "skill.md")) return tr("这是 Skill 文件，请在设置的 Skill 管理中上传。");
  if (extensions.some((extension) => ![".json", ".jsonl", ".gz", ".md", ".markdown", ".txt", ".html", ".htm"].includes(extension))) return tr("仅支持 JSON、Markdown 或文本源文件。");
  if (files.length > 500) return tr("一次最多分析 500 个文件。");
  return null;
}

function fileExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".canonical.jsonl.gz")) return ".gz";
  if (lower.endsWith(".canonical.jsonl")) return ".jsonl";
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

function ErrorLine({ message, action = "read", onRetry, retrying = false }: {
  message: unknown;
  action?: "read" | "mutation" | "commit";
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const tr = useImportCopy();
  return (
    <div role="alert" className={`border-l-2 border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)] ${onRetry ? "flex flex-wrap items-center justify-between gap-3" : ""}`}>
      <span>{importErrorMessage(message, tr, action)}</span>
      {onRetry ? <button type="button" disabled={retrying} onClick={onRetry} className="btn-secondary inline-flex min-h-9 shrink-0 items-center gap-2 px-3 text-xs font-medium">
        {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}{tr("重试")}
      </button> : null}
    </div>
  );
}
